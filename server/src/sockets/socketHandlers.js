import {
  EVENTS, RECONNECT_GRACE_MS, NAME_MAX_LEN, NAME_MIN_LEN,
  ROOM_CODE_LEN, MAX_PLACEMENTS_PER_MOVE,
} from '../events.js';
import { roomManager } from '../rooms/roomManager.js';
import { reconnectTokens } from '../rooms/reconnectTokens.js';
import { applyMove, passTurn, swapTiles } from '../game/gameEngine.js';
import { TurnTimer } from '../game/turnTimer.js';
import { createSocketRateLimiter } from '../middleware/rateLimiter.js';
import { randomBytes } from 'crypto';
import { log } from '../logger.js';
import { prisma } from '../db.js';
import { presence } from '../social/presence.js';
import { invitesService } from '../social/invitesService.js';
import { friendsService } from '../social/friendsService.js';
import { Matchmaker } from '../matchmaking/matchmaker.js';
import { maybeRunBotTurn } from '../bot/scheduler.js';

const rateLimiter = createSocketRateLimiter({ capacity: 15, refillMs: 1000 });

// Module-scoped matchmaker singleton
let matchmaker = null;

function newSeatId() {
  return randomBytes(8).toString('hex');
}

// ============================================================
// Input sanitization
// ============================================================

function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, NAME_MAX_LEN);
  if (trimmed.length < NAME_MIN_LEN) return null;
  if (!/^[\x20-\x7E]+$/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeRoomCode(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LEN) return null;
  if (!/^[A-Z2-9]+$/.test(code)) return null;
  return code;
}

function sanitizePlacements(raw) {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0 || raw.length > MAX_PLACEMENTS_PER_MOVE) return null;
  const out = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') return null;
    const row = Number(p.row), col = Number(p.col);
    if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
    if (row < 0 || row > 14 || col < 0 || col > 14) return null;
    if (typeof p.letter !== 'string' || p.letter.length !== 1) return null;
    if (!/^[A-Za-z]$/.test(p.letter)) return null;
    out.push({ row, col, letter: p.letter.toUpperCase(), blank: !!p.blank });
  }
  return out;
}

function sanitizeTiles(raw) {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0 || raw.length > 7) return null;
  const out = [];
  for (const t of raw) {
    if (typeof t !== 'string' || t.length !== 1) return null;
    const T = t.toUpperCase();
    if (!/^[A-Z_]$/.test(T)) return null;
    out.push(T);
  }
  return out;
}

// ============================================================
// Bot name pool
// ============================================================

const BOT_NAME_POOL = [
  'Botson', 'Tilebot', 'WordWiz', 'Letterly', 'Vowelina',
  'Anagrim', 'Lexa', 'Sage', 'Quibble', 'Crossly',
];

function pickBotNames(n, difficulty) {
  const tag = { easy: '🤖', medium: '🤖', hard: '🦾' }[difficulty] || '🤖';
  const shuffled = [...BOT_NAME_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n).map((name) => `${tag} ${name}`);
}

// ============================================================
// Public room view
// ============================================================

function publicRoomView(room) {
  if (!room) return null;
  return {
    id: room.id,
    hostSeatId: room.hostSeatId,
    players: room.players.map((p) => ({
      seatId: p.seatId,
      name: p.name,
      connected: p.connected,
      isBot: !!p.isBot,
    })),
    spectatorCount: room.spectators?.length || 0,
    status: room.gameState.status,
    currentTurnSeatId: room.currentTurnSeatId,
    turnOrder: room.turnOrder,
    scores: room.gameState.scores,
    board: room.gameState.board,
    bagCount: room.gameState.bag ? room.gameState.bag.length : 0,
    turnNumber: room.gameState.turnNumber,
    moveHistory: room.gameState.moveHistory,
    isFirstMove: room.gameState.isFirstMove,
    rackCounts: Object.fromEntries(
      Object.entries(room.gameState.racks || {}).map(([sid, rack]) => [sid, rack.length])
    ),
    turnExpiresAt: room.turnTimer ? room.turnTimer.expiresAt : null,
    mode: room.mode || 'private',
  };
}

function annotateOnline({ friends, incoming, outgoing }) {
  const wrap = (arr) => arr.map((f) => ({ ...f, online: presence.isOnline(f.userId) }));
  return {
    friends: wrap(friends),
    incoming: wrap(incoming),
    outgoing: wrap(outgoing),
  };
}

function broadcastRoom(io, room) {
  io.to(room.id).emit(EVENTS.ROOM_STATE, publicRoomView(room));
}

function sendRack(io, room, seat) {
  if (!seat || !seat.socketId) return;
  const rack = room.gameState.racks?.[seat.seatId] || [];
  io.to(seat.socketId).emit(EVENTS.RACK_UPDATE, { rack });
}

function sendAllRacks(io, room) {
  for (const seat of room.players) {
    if (seat.isBot) continue; // bots don't have sockets
    sendRack(io, room, seat);
  }
}

function getSeatForSocket(room, socketId) {
  return room.players.find((p) => p.socketId === socketId);
}

// ============================================================
// Turn timer
// ============================================================

function startTurnTimer(io, room) {
  if (!room.turnTimer) room.turnTimer = new TurnTimer();
  room.turnTimer.start(() => onTurnTimeout(io, room.id));
  io.to(room.id).emit(EVENTS.TURN_TIMER, {
    expiresAt: room.turnTimer.expiresAt,
    currentTurnSeatId: room.currentTurnSeatId,
  });
}

function cancelTurnTimer(room) {
  if (room.turnTimer) room.turnTimer.cancel();
}

async function onTurnTimeout(io, roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  if (room.gameState.status !== 'in_progress') return;

  const seatId = room.currentTurnSeatId;
  const result = passTurn(room, seatId, { auto: true });
  if (!result.ok) return;

  await roomManager.updateGameState(roomId, result.newGameState, result.nextSeatId, {
    seatId, turn: result.newGameState.turnNumber - 1, type: 'timeout',
  });
  io.to(roomId).emit(EVENTS.TURN_TIMEOUT, { seatId });
  broadcastRoom(io, room);

  if (result.newGameState.status === 'finished') {
    await updateUserStatsOnGameEnd(room, result.newGameState).catch((err) =>
      log.error('stats.update.fail', { err: String(err) })
    );
    io.to(roomId).emit(EVENTS.GAME_ENDED, {
      reason: result.endReason,
      finalScores: result.newGameState.scores,
    });
    cancelTurnTimer(room);
  } else {
    startTurnTimer(io, room);
    maybeRunBotTurn(io, roomId, botHelpers);
  }
}

// ============================================================
// Stats on game end
// ============================================================

async function updateUserStatsOnGameEnd(room, gameState) {
  const seats = room.players.map((p) => ({
    seatId: p.seatId,
    userId: p.userId,
    score: gameState.scores[p.seatId] || 0,
  }));
  if (seats.length === 0) return;
  const maxScore = Math.max(...seats.map((s) => s.score));
  const winners = seats.filter((s) => s.score === maxScore);

  for (const seat of seats) {
    if (!seat.userId) continue;
    const won = winners.length === 1 && winners[0].seatId === seat.seatId;
    await prisma.user.update({
      where: { id: seat.userId },
      data: {
        gamesPlayed: { increment: 1 },
        gamesWon: won ? { increment: 1 } : undefined,
        totalScore: { increment: seat.score },
      },
    });
    const u = await prisma.user.findUnique({ where: { id: seat.userId } });
    if (u && seat.score > u.highestScore) {
      await prisma.user.update({ where: { id: seat.userId }, data: { highestScore: seat.score } });
    }
  }
}

// ============================================================
// Helpers passed to bot scheduler (avoids circular imports)
// ============================================================

const botHelpers = {
  broadcastRoom,
  sendAllRacks,
  startTurnTimer,
  cancelTurnTimer,
  updateUserStatsOnGameEnd,
};

// ============================================================
// Rate-limited handler wrapper
// ============================================================

function gate(socket, fn) {
  return async (...args) => {
    const ack = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    if (!rateLimiter.allow(socket.id)) {
      return ack?.({ ok: false, error: 'Too many requests. Slow down.' });
    }
    try {
      await fn(...args);
    } catch (err) {
      log.error('handler.error', { err: String(err), stack: err?.stack });
      ack?.({ ok: false, error: 'Internal error' });
    }
  };
}

// ============================================================
// Matchmaker initialization (called from index.js)
// ============================================================

export function initMatchmaker(io) {
  if (matchmaker) return matchmaker;
  matchmaker = new Matchmaker({
    onMatch: async (entries, size) => {
      try {
        const sockets = entries
          .map((e) => ({ entry: e, socket: io.sockets.sockets.get(e.socketId) }))
          .filter((s) => s.socket && s.socket.connected);

        if (sockets.length < size) {
          for (const s of sockets) {
            await matchmaker.enqueue(s.entry.userId, s.socket.id, 1200, size).catch(() => {});
          }
          return;
        }

        const users = await prisma.user.findMany({
          where: { id: { in: entries.map((e) => e.userId) } },
          select: { id: true, displayName: true },
        });
        const nameOf = new Map(users.map((u) => [u.id, u.displayName]));

        const first = sockets[0];
        const hostSeatId = newSeatId();
        const hostSeat = {
          seatId: hostSeatId,
          socketId: first.socket.id,
          name: nameOf.get(first.entry.userId) || 'Player',
          connected: true,
          userId: first.entry.userId,
        };
        const room = await roomManager.createRoom(hostSeat);

        await prisma.room.update({
          where: { id: room.id },
          data: { mode: 'quick_match' },
        }).catch(() => {});
        room.mode = 'quick_match';

        first.socket.join(room.id);
        first.socket.data.roomId = room.id;
        first.socket.data.seatId = hostSeatId;
        first.socket.data.role = 'player';
        const hostToken = reconnectTokens.issue(room.id, hostSeatId, hostSeat.name, RECONNECT_GRACE_MS);
        first.socket.emit(EVENTS.QUEUE_MATCHED, {
          room: publicRoomView(room),
          seatId: hostSeatId,
          reconnectToken: hostToken,
        });

        for (let i = 1; i < sockets.length; i++) {
          const { socket, entry } = sockets[i];
          const seatId = newSeatId();
          const seat = {
            seatId,
            socketId: socket.id,
            name: nameOf.get(entry.userId) || 'Player',
            connected: true,
            userId: entry.userId,
          };
          const result = await roomManager.joinRoom(room.id, seat);
          if (result.error) continue;
          socket.join(room.id);
          socket.data.roomId = room.id;
          socket.data.seatId = seatId;
          socket.data.role = 'player';
          const token = reconnectTokens.issue(room.id, seatId, seat.name, RECONNECT_GRACE_MS);
          socket.emit(EVENTS.QUEUE_MATCHED, {
            room: publicRoomView(result.room),
            seatId,
            reconnectToken: token,
          });
          io.to(room.id).emit(EVENTS.PLAYER_JOINED, { player: { seatId, name: seat.name } });
        }

        const finalRoom = roomManager.getRoom(room.id);
        if (!finalRoom) return;
        broadcastRoom(io, finalRoom);

        const startResult = await roomManager.startGame(finalRoom.id, finalRoom.hostSeatId);
        if (startResult.error) {
          log.warn('matchmaker.autostart.fail', { err: startResult.error });
          return;
        }
        sendAllRacks(io, startResult.room);
        io.to(finalRoom.id).emit(EVENTS.GAME_STARTED, publicRoomView(startResult.room));
        broadcastRoom(io, startResult.room);
        startTurnTimer(io, startResult.room);
      } catch (err) {
        log.error('matchmaker.onMatch.exception', { err: String(err), stack: err?.stack });
      }
    },
  });
  matchmaker.start();
  setInterval(() => invitesService.sweep().catch(() => {}), 60_000);
  return matchmaker;
}

// ============================================================
// Game-invite delivery (called from REST routes)
// ============================================================

export function notifyGameInvite(io, invite, fromUser) {
  for (const sid of presence.socketsFor(invite.toUserId)) {
    io.to(sid).emit(EVENTS.GAME_INVITE_RECEIVED, {
      inviteId: invite.id,
      roomId: invite.roomId,
      fromUser: {
        id: fromUser.id,
        displayName: fromUser.displayName,
        avatarUrl: fromUser.avatarUrl,
      },
      expiresAt: invite.expiresAt,
    });
  }
}

// ============================================================
// Main socket handler registration
// ============================================================

export function registerSocketHandlers(io, socket) {

  // ---------- Phase 7: presence + pending-invite delivery ----------
  if (socket.data.userId) {
    const justOnline = presence.add(socket.data.userId, socket.id);
    if (justOnline) {
      friendsService.friendIdsOf(socket.data.userId).then((friendIds) => {
        for (const fid of friendIds) {
          for (const fsock of presence.socketsFor(fid)) {
            io.to(fsock).emit(EVENTS.FRIENDS_UPDATE, { type: 'online', userId: socket.data.userId });
          }
        }
      }).catch(() => {});
    }

    invitesService.listIncoming(socket.data.userId).then((invites) => {
      for (const inv of invites) {
        socket.emit(EVENTS.GAME_INVITE_RECEIVED, {
          inviteId: inv.id,
          roomId: inv.roomId,
          fromUser: inv.fromUser,
          expiresAt: inv.expiresAt,
        });
      }
    }).catch(() => {});
  }

  // ---------- CREATE ROOM ----------
  socket.on(EVENTS.CREATE_ROOM, gate(socket, async ({ playerName } = {}, ack) => {
    const name = sanitizeName(playerName);
    if (!name) return ack?.({ ok: false, error: 'Invalid name' });

    const seatId = newSeatId();
    const seat = {
      seatId,
      socketId: socket.id,
      name,
      connected: true,
      userId: socket.data.userId || null,
    };
    const room = await roomManager.createRoom(seat);

    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.seatId = seatId;
    socket.data.role = 'player';

    const reconnectToken = reconnectTokens.issue(room.id, seatId, name, RECONNECT_GRACE_MS);
    log.info('room.create', { roomId: room.id, seatId, name });
    ack?.({ ok: true, room: publicRoomView(room), seatId, reconnectToken });
    broadcastRoom(io, room);
  }));

  // ---------- CREATE BOT ROOM ----------
  socket.on(EVENTS.CREATE_BOT_ROOM, gate(socket, async ({ playerName, difficulty, numBots } = {}, ack) => {
    const name = sanitizeName(playerName);
    if (!name) return ack?.({ ok: false, error: 'Invalid name' });

    const diff = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
    const bots = Math.min(Math.max(parseInt(numBots, 10) || 1, 1), 3);

    // 1) Create room with the human host
    const seatId = newSeatId();
    const seat = {
      seatId,
      socketId: socket.id,
      name,
      connected: true,
      userId: socket.data.userId || null,
    };
    const room = await roomManager.createRoom(seat);

    await prisma.room.update({
      where: { id: room.id },
      data: { mode: 'vs_computer' },
    }).catch(() => {});
    room.mode = 'vs_computer';

    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.seatId = seatId;
    socket.data.role = 'player';

    // 2) Add bots as additional seats
    const botNames = pickBotNames(bots, diff);
    for (let i = 0; i < bots; i++) {
      const botSeatId = newSeatId();
      const botSeat = {
        seatId: botSeatId,
        socketId: null,
        name: botNames[i],
        connected: true,
        userId: null,
        isBot: true,
        botDifficulty: diff,
      };
      const result = await roomManager.joinRoom(room.id, botSeat);
      if (result.error) {
        log.error('bot.join.fail', { err: result.error });
        continue;
      }
      await prisma.seat.update({
        where: { id: botSeatId },
        data: { isBot: true },
      }).catch(() => {});
    }

    const finalRoom = roomManager.getRoom(room.id);
    const reconnectToken = reconnectTokens.issue(room.id, seatId, name, RECONNECT_GRACE_MS);
    log.info('bot.room.create', { roomId: room.id, bots, difficulty: diff });

    ack?.({ ok: true, room: publicRoomView(finalRoom), seatId, reconnectToken });
    broadcastRoom(io, finalRoom);

    // 3) Auto-start the game
    const startResult = await roomManager.startGame(room.id, seatId);
    if (startResult.error) {
      log.warn('bot.autostart.fail', { err: startResult.error });
      return;
    }
    sendAllRacks(io, startResult.room);
    io.to(room.id).emit(EVENTS.GAME_STARTED, publicRoomView(startResult.room));
    broadcastRoom(io, startResult.room);
    startTurnTimer(io, startResult.room);

    // 4) If bots go first, kick them off
    maybeRunBotTurn(io, room.id, botHelpers);
  }));

  // ---------- JOIN ROOM ----------
  socket.on(EVENTS.JOIN_ROOM, gate(socket, async ({ roomId, playerName } = {}, ack) => {
    const id = sanitizeRoomCode(roomId);
    const name = sanitizeName(playerName);
    if (!id) return ack?.({ ok: false, error: 'Invalid room code' });
    if (!name) return ack?.({ ok: false, error: 'Invalid name' });

    const seatId = newSeatId();
    const seat = {
      seatId,
      socketId: socket.id,
      name,
      connected: true,
      userId: socket.data.userId || null,
    };
    const result = await roomManager.joinRoom(id, seat);
    if (result.error) return ack?.({ ok: false, error: result.error });

    socket.join(id);
    socket.data.roomId = id;
    socket.data.seatId = seatId;
    socket.data.role = 'player';

    const reconnectToken = reconnectTokens.issue(id, seatId, name, RECONNECT_GRACE_MS);
    log.info('room.join', { roomId: id, seatId, name });
    ack?.({ ok: true, room: publicRoomView(result.room), seatId, reconnectToken });
    io.to(id).emit(EVENTS.PLAYER_JOINED, { player: { seatId, name } });
    broadcastRoom(io, result.room);
  }));

  // ---------- SPECTATE ----------
  socket.on(EVENTS.SPECTATE_ROOM, gate(socket, ({ roomId, spectatorName } = {}, ack) => {
    const id = sanitizeRoomCode(roomId);
    const name = sanitizeName(spectatorName) || 'Spectator';
    if (!id) return ack?.({ ok: false, error: 'Invalid room code' });

    const result = roomManager.addSpectator(id, { socketId: socket.id, name });
    if (result.error) return ack?.({ ok: false, error: result.error });

    socket.join(id);
    socket.data.roomId = id;
    socket.data.role = 'spectator';
    socket.data.spectatorName = name;

    log.info('room.spectate', { roomId: id, name });
    ack?.({ ok: true, room: publicRoomView(result.room) });
    io.to(id).emit(EVENTS.SPECTATOR_JOINED, { name });
    broadcastRoom(io, result.room);
  }));

  // ---------- REJOIN (reconnection) ----------
  socket.on(EVENTS.REJOIN_ROOM, gate(socket, async ({ reconnectToken } = {}, ack) => {
    if (typeof reconnectToken !== 'string' || reconnectToken.length > 64) {
      return ack?.({ ok: false, error: 'Missing reconnect token' });
    }
    const record = reconnectTokens.consume(reconnectToken);
    if (!record) return ack?.({ ok: false, error: 'Reconnect token expired or invalid' });

    const result = await roomManager.rejoinRoom(record.roomId, record.seatId, socket.id);
    if (result.error) return ack?.({ ok: false, error: result.error });

    socket.join(record.roomId);
    socket.data.roomId = record.roomId;
    socket.data.seatId = record.seatId;
    socket.data.role = 'player';

    const newToken = reconnectTokens.issue(record.roomId, record.seatId, record.name, RECONNECT_GRACE_MS);

    log.info('room.rejoin', { roomId: record.roomId, seatId: record.seatId });
    ack?.({
      ok: true,
      room: publicRoomView(result.room),
      seatId: record.seatId,
      reconnectToken: newToken,
    });

    const seat = result.room.players.find((p) => p.seatId === record.seatId);
    sendRack(io, result.room, seat);

    io.to(record.roomId).emit(EVENTS.PLAYER_RECONNECTED, { seatId: record.seatId, name: record.name });
    broadcastRoom(io, result.room);

    if (
      result.room.gameState.status === 'in_progress' &&
      result.room.currentTurnSeatId === record.seatId
    ) {
      startTurnTimer(io, result.room);
    }

    // If a bot's turn was waiting on this player to come back, kick off.
    maybeRunBotTurn(io, record.roomId, botHelpers);
  }));

  // ---------- LEAVE ROOM ----------
  socket.on(EVENTS.LEAVE_ROOM, gate(socket, async (_p, ack) => {
    const roomId = socket.data.roomId;
    const role = socket.data.role;
    if (roomId) {
      const room = roomManager.getRoom(roomId);
      if (room) {
        if (role === 'spectator') {
          roomManager.removeSpectator(roomId, socket.id);
          io.to(roomId).emit(EVENTS.SPECTATOR_LEFT, { name: socket.data.spectatorName });
          broadcastRoom(io, room);
        } else if (socket.data.seatId) {
          const res = await roomManager.removeSeat(roomId, socket.data.seatId);
          if (res && !res.deleted) {
            io.to(roomId).emit(EVENTS.PLAYER_LEFT, { seatId: socket.data.seatId });
            broadcastRoom(io, res.room);
          }
        }
      }
      socket.leave(roomId);
    }
    socket.data.roomId = null;
    socket.data.seatId = null;
    socket.data.role = null;
    ack?.({ ok: true });
  }));

  // ---------- START GAME ----------
  socket.on(EVENTS.START_GAME, gate(socket, async (_p, ack) => {
    const roomId = socket.data.roomId;
    const seatId = socket.data.seatId;
    if (!roomId || !seatId) return ack?.({ ok: false, error: 'Not in a room' });
    if (socket.data.role !== 'player') return ack?.({ ok: false, error: 'Spectators cannot start games' });

    const result = await roomManager.startGame(roomId, seatId);
    if (result.error) return ack?.({ ok: false, error: result.error });

    const room = result.room;
    sendAllRacks(io, room);
    log.info('game.start', { roomId, players: room.players.length });
    io.to(roomId).emit(EVENTS.GAME_STARTED, publicRoomView(room));
    broadcastRoom(io, room);
    startTurnTimer(io, room);
    maybeRunBotTurn(io, roomId, botHelpers);
    ack?.({ ok: true });
  }));

  // ---------- SUBMIT MOVE ----------
  socket.on(EVENTS.SUBMIT_MOVE, gate(socket, async ({ placements } = {}, ack) => {
    const roomId = socket.data.roomId;
    const seatId = socket.data.seatId;
    if (socket.data.role !== 'player') return ack?.({ ok: false, error: 'Spectators cannot move' });

    const room = roomManager.getRoom(roomId);
    if (!room || !seatId) return ack?.({ ok: false, error: 'Room not found' });

    const sane = sanitizePlacements(placements);
    if (!sane) return ack?.({ ok: false, error: 'Invalid placements' });

    const result = applyMove(room, seatId, sane);
    if (!result.ok) {
      socket.emit(EVENTS.MOVE_REJECTED, {
        error: result.error,
        invalidWords: result.invalidWords || null,
      });
      return ack?.({ ok: false, error: result.error, invalidWords: result.invalidWords });
    }

    await roomManager.updateGameState(roomId, result.newGameState, result.nextSeatId, {
      seatId,
      turn: result.newGameState.turnNumber - 1,
      type: 'move',
      placements: sane,
      words: result.words,
      score: result.score,
    });
    const seat = getSeatForSocket(room, socket.id);
    sendRack(io, room, seat);

    io.to(roomId).emit(EVENTS.MOVE_APPLIED, {
      seatId, placements: sane, score: result.score, words: result.words,
    });
    broadcastRoom(io, room);

    if (result.newGameState.status === 'finished') {
      await updateUserStatsOnGameEnd(room, result.newGameState).catch((err) =>
        log.error('stats.update.fail', { err: String(err) })
      );
      io.to(roomId).emit(EVENTS.GAME_ENDED, {
        reason: result.endReason,
        finalScores: result.newGameState.scores,
      });
      cancelTurnTimer(room);
    } else {
      startTurnTimer(io, room);
      maybeRunBotTurn(io, roomId, botHelpers);
    }

    ack?.({ ok: true, score: result.score, words: result.words });
  }));

  // ---------- PASS ----------
  socket.on(EVENTS.PASS_TURN, gate(socket, async (_p, ack) => {
    const roomId = socket.data.roomId;
    const seatId = socket.data.seatId;
    if (socket.data.role !== 'player') return ack?.({ ok: false, error: 'Spectators cannot pass' });

    const room = roomManager.getRoom(roomId);
    if (!room || !seatId) return ack?.({ ok: false, error: 'Room not found' });

    const result = passTurn(room, seatId);
    if (!result.ok) return ack?.({ ok: false, error: result.error });

    await roomManager.updateGameState(roomId, result.newGameState, result.nextSeatId, {
      seatId, turn: result.newGameState.turnNumber - 1, type: 'pass',
    });
    broadcastRoom(io, room);

    if (result.newGameState.status === 'finished') {
      await updateUserStatsOnGameEnd(room, result.newGameState).catch((err) =>
        log.error('stats.update.fail', { err: String(err) })
      );
      io.to(roomId).emit(EVENTS.GAME_ENDED, {
        reason: result.endReason,
        finalScores: result.newGameState.scores,
      });
      cancelTurnTimer(room);
    } else {
      startTurnTimer(io, room);
      maybeRunBotTurn(io, roomId, botHelpers);
    }
    ack?.({ ok: true });
  }));

  // ---------- SWAP ----------
  socket.on(EVENTS.SWAP_TILES, gate(socket, async ({ tiles } = {}, ack) => {
    const roomId = socket.data.roomId;
    const seatId = socket.data.seatId;
    if (socket.data.role !== 'player') return ack?.({ ok: false, error: 'Spectators cannot swap' });

    const room = roomManager.getRoom(roomId);
    if (!room || !seatId) return ack?.({ ok: false, error: 'Room not found' });

    const sane = sanitizeTiles(tiles);
    if (!sane) return ack?.({ ok: false, error: 'Invalid tiles' });

    const result = swapTiles(room, seatId, sane);
    if (!result.ok) return ack?.({ ok: false, error: result.error });

    await roomManager.updateGameState(roomId, result.newGameState, result.nextSeatId, {
      seatId, turn: result.newGameState.turnNumber - 1, type: 'swap',
    });
    const seat = getSeatForSocket(room, socket.id);
    sendRack(io, room, seat);
    broadcastRoom(io, room);
    startTurnTimer(io, room);
    maybeRunBotTurn(io, roomId, botHelpers);
    ack?.({ ok: true });
  }));

  // ---------- QUEUE_JOIN ----------
  socket.on(EVENTS.QUEUE_JOIN, gate(socket, async ({ desiredSize } = {}, ack) => {
    if (!socket.data.userId) return ack?.({ ok: false, error: 'Sign in to use matchmaking' });
    const size = Number(desiredSize);
    if (!Number.isInteger(size) || size < 2 || size > 4) {
      return ack?.({ ok: false, error: 'Invalid size (must be 2, 3, or 4)' });
    }
    if (socket.data.roomId) return ack?.({ ok: false, error: 'Already in a room' });

    const user = await prisma.user.findUnique({
      where: { id: socket.data.userId },
      select: { rating: true },
    });
    if (!user) return ack?.({ ok: false, error: 'User not found' });

    await matchmaker.enqueue(socket.data.userId, socket.id, user.rating, size);
    socket.data.inQueue = true;
    socket.emit(EVENTS.QUEUE_STATE, { inQueue: true, desiredSize: size });
    ack?.({ ok: true });
  }));

  // ---------- QUEUE_LEAVE ----------
  socket.on(EVENTS.QUEUE_LEAVE, gate(socket, async (_p, ack) => {
    if (!socket.data.userId) return ack?.({ ok: false });
    await matchmaker.dequeue(socket.data.userId);
    socket.data.inQueue = false;
    socket.emit(EVENTS.QUEUE_STATE, { inQueue: false });
    ack?.({ ok: true });
  }));

  // ---------- FRIEND_INVITE_RESPOND ----------
  socket.on(EVENTS.FRIEND_INVITE_RESPOND, gate(socket, async ({ friendshipId, accept } = {}, ack) => {
    if (!socket.data.userId) return ack?.({ ok: false, error: 'Sign in required' });
    const result = await friendsService.respond(socket.data.userId, friendshipId, !!accept);
    if (result.error) return ack?.({ ok: false, error: result.error });

    const myFriendsList = await friendsService.listFor(socket.data.userId);
    for (const sid of presence.socketsFor(socket.data.userId)) {
      io.to(sid).emit(EVENTS.FRIENDS_UPDATE, { type: 'list', ...annotateOnline(myFriendsList) });
    }
    if (result.friendship && accept) {
      const otherUserId = result.friendship.userId === socket.data.userId
        ? result.friendship.friendId
        : result.friendship.userId;
      const theirFriends = await friendsService.listFor(otherUserId);
      for (const sid of presence.socketsFor(otherUserId)) {
        io.to(sid).emit(EVENTS.FRIENDS_UPDATE, { type: 'list', ...annotateOnline(theirFriends) });
      }
    }
    ack?.({ ok: true });
  }));

  // ---------- GAME_INVITE_RESPOND ----------
  socket.on(EVENTS.GAME_INVITE_RESPOND, gate(socket, async ({ inviteId, accept } = {}, ack) => {
    if (!socket.data.userId) return ack?.({ ok: false, error: 'Sign in required' });
    const result = await invitesService.respond(socket.data.userId, inviteId, !!accept);
    if (result.error) return ack?.({ ok: false, error: result.error });
    ack?.({ ok: true, roomId: result.invite?.roomId, accepted: !!accept });
  }));

  // ---------- DISCONNECT ----------
  socket.on('disconnect', (reason) => {
    log.info('socket.disconnect', { socketId: socket.id, reason });
    rateLimiter.forget(socket.id);

    if (socket.data.userId) {
      const presResult = presence.remove(socket.id);
      if (presResult?.justWentOffline) {
        friendsService.friendIdsOf(socket.data.userId).then((friendIds) => {
          for (const fid of friendIds) {
            for (const fsock of presence.socketsFor(fid)) {
              io.to(fsock).emit(EVENTS.FRIENDS_UPDATE, { type: 'offline', userId: socket.data.userId });
            }
          }
        }).catch(() => {});
      }
      matchmaker?.dequeueBySocket(socket.id).catch(() => {});
    }

    const roomId = socket.data.roomId;
    if (!roomId) return;

    if (socket.data.role === 'spectator') {
      const res = roomManager.removeSpectator(roomId, socket.id);
      if (res?.room) {
        io.to(roomId).emit(EVENTS.SPECTATOR_LEFT, { name: socket.data.spectatorName });
        broadcastRoom(io, res.room);
      }
      return;
    }

    const disc = roomManager.handleDisconnect(roomId, socket.id, async (graceResult) => {
      if (!graceResult) return;
      const room = roomManager.getRoom(roomId);
      if (graceResult.deleted) return;
      io.to(roomId).emit(EVENTS.PLAYER_LEFT, { seatId: graceResult.seatId });
      if (room) {
        broadcastRoom(io, room);
        if (room.gameState.status === 'finished') {
          await updateUserStatsOnGameEnd(room, room.gameState).catch(() => {});
          io.to(roomId).emit(EVENTS.GAME_ENDED, {
            reason: 'not_enough_players',
            finalScores: room.gameState.scores,
          });
          cancelTurnTimer(room);
        }
      }
    });

    if (!disc) return;
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    if (disc.softDisconnect) {
      io.to(roomId).emit(EVENTS.PLAYER_DISCONNECTED, { seatId: disc.seatId });
      broadcastRoom(io, room);
    } else if (!disc.deleted) {
      io.to(roomId).emit(EVENTS.PLAYER_LEFT, { seatId: disc.seatId });
      broadcastRoom(io, room);
    }
  });
}