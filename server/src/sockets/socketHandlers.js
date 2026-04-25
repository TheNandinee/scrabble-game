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

const rateLimiter = createSocketRateLimiter({ capacity: 15, refillMs: 1000 });

function newSeatId() {
  return randomBytes(8).toString('hex');
}

// ---------- input validation helpers ----------

function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, NAME_MAX_LEN);
  if (trimmed.length < NAME_MIN_LEN) return null;
  // Only allow visible characters; reject control codes
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
    out.push({
      row, col,
      letter: p.letter.toUpperCase(),
      blank: !!p.blank,
    });
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

// ---------- public room view ----------

function publicRoomView(room) {
  if (!room) return null;
  return {
    id: room.id,
    hostSeatId: room.hostSeatId,
    players: room.players.map((p) => ({
      seatId: p.seatId,
      name: p.name,
      connected: p.connected,
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
  for (const seat of room.players) sendRack(io, room, seat);
}

function getSeatForSocket(room, socketId) {
  return room.players.find((p) => p.socketId === socketId);
}

// ---------- turn timer ----------

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

function onTurnTimeout(io, roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  if (room.gameState.status !== 'in_progress') return;

  const seatId = room.currentTurnSeatId;
  const result = passTurn(room, seatId, { auto: true });
  if (!result.ok) return;

  roomManager.updateGameState(roomId, result.newGameState, result.nextSeatId);
  io.to(roomId).emit(EVENTS.TURN_TIMEOUT, { seatId });
  broadcastRoom(io, room);

  if (result.newGameState.status === 'finished') {
    io.to(roomId).emit(EVENTS.GAME_ENDED, {
      reason: result.endReason,
      finalScores: result.newGameState.scores,
    });
    cancelTurnTimer(room);
  } else {
    startTurnTimer(io, room);
  }
}

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

// ---------- handlers ----------

export function registerSocketHandlers(io, socket) {
  socket.on(EVENTS.CREATE_ROOM, gate(socket, ({ playerName } = {}, ack) => {
    const name = sanitizeName(playerName);
    if (!name) return ack?.({ ok: false, error: 'Invalid name' });

    const seatId = newSeatId();
    const seat = { seatId, socketId: socket.id, name, connected: true };
    const room = roomManager.createRoom(seat);

    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.seatId = seatId;
    socket.data.role = 'player';

    const reconnectToken = reconnectTokens.issue(room.id, seatId, name, RECONNECT_GRACE_MS);
    log.info('room.create', { roomId: room.id, seatId, name });
    ack?.({ ok: true, room: publicRoomView(room), seatId, reconnectToken });
    broadcastRoom(io, room);
  }));

  socket.on(EVENTS.JOIN_ROOM, gate(socket, ({ roomId, playerName } = {}, ack) => {
    const id = sanitizeRoomCode(roomId);
    const name = sanitizeName(playerName);
    if (!id) return ack?.({ ok: false, error: 'Invalid room code' });
    if (!name) return ack?.({ ok: false, error: 'Invalid name' });

    const seatId = newSeatId();
    const seat = { seatId, socketId: socket.id, name, connected: true };
    const result = roomManager.joinRoom(id, seat);
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

  socket.on(EVENTS.REJOIN_ROOM, gate(socket, ({ reconnectToken } = {}, ack) => {
    if (typeof reconnectToken !== 'string' || reconnectToken.length > 64) {
      return ack?.({ ok: false, error: 'Missing reconnect token' });
    }
    const record = reconnectTokens.consume(reconnectToken);
    if (!record) return ack?.({ ok: false, error: 'Reconnect token expired or invalid' });

    const result = roomManager.rejoinRoom(record.roomId, record.seatId, socket.id);
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
  }));

  socket.on(EVENTS.LEAVE_ROOM, gate(socket, (_p, ack) => {
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
          const res = roomManager.removeSeat(roomId, socket.data.seatId);
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

  socket.on(EVENTS.START_GAME, gate(socket, (_p, ack) => {
    const roomId = socket.data.roomId;
    const seatId = socket.data.seatId;
    if (!roomId || !seatId) return ack?.({ ok: false, error: 'Not in a room' });
    if (socket.data.role !== 'player') return ack?.({ ok: false, error: 'Spectators cannot start games' });

    const result = roomManager.startGame(roomId, seatId);
    if (result.error) return ack?.({ ok: false, error: result.error });

    const room = result.room;
    sendAllRacks(io, room);
    log.info('game.start', { roomId, players: room.players.length });
    io.to(roomId).emit(EVENTS.GAME_STARTED, publicRoomView(room));
    broadcastRoom(io, room);
    startTurnTimer(io, room);
    ack?.({ ok: true });
  }));

  socket.on(EVENTS.SUBMIT_MOVE, gate(socket, ({ placements } = {}, ack) => {
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

    roomManager.updateGameState(roomId, result.newGameState, result.nextSeatId);
    const seat = getSeatForSocket(room, socket.id);
    sendRack(io, room, seat);

    io.to(roomId).emit(EVENTS.MOVE_APPLIED, {
      seatId, placements: sane, score: result.score, words: result.words,
    });
    broadcastRoom(io, room);

    if (result.newGameState.status === 'finished') {
      io.to(roomId).emit(EVENTS.GAME_ENDED, {
        reason: result.endReason,
        finalScores: result.newGameState.scores,
      });
      cancelTurnTimer(room);
    } else {
      startTurnTimer(io, room);
    }

    ack?.({ ok: true, score: result.score, words: result.words });
  }));

  socket.on(EVENTS.PASS_TURN, gate(socket, (_p, ack) => {
    const roomId = socket.data.roomId;
    const seatId = socket.data.seatId;
    if (socket.data.role !== 'player') return ack?.({ ok: false, error: 'Spectators cannot pass' });

    const room = roomManager.getRoom(roomId);
    if (!room || !seatId) return ack?.({ ok: false, error: 'Room not found' });

    const result = passTurn(room, seatId);
    if (!result.ok) return ack?.({ ok: false, error: result.error });

    roomManager.updateGameState(roomId, result.newGameState, result.nextSeatId);
    broadcastRoom(io, room);

    if (result.newGameState.status === 'finished') {
      io.to(roomId).emit(EVENTS.GAME_ENDED, {
        reason: result.endReason,
        finalScores: result.newGameState.scores,
      });
      cancelTurnTimer(room);
    } else {
      startTurnTimer(io, room);
    }
    ack?.({ ok: true });
  }));

  socket.on(EVENTS.SWAP_TILES, gate(socket, ({ tiles } = {}, ack) => {
    const roomId = socket.data.roomId;
    const seatId = socket.data.seatId;
    if (socket.data.role !== 'player') return ack?.({ ok: false, error: 'Spectators cannot swap' });

    const room = roomManager.getRoom(roomId);
    if (!room || !seatId) return ack?.({ ok: false, error: 'Room not found' });

    const sane = sanitizeTiles(tiles);
    if (!sane) return ack?.({ ok: false, error: 'Invalid tiles' });

    const result = swapTiles(room, seatId, sane);
    if (!result.ok) return ack?.({ ok: false, error: result.error });

    roomManager.updateGameState(roomId, result.newGameState, result.nextSeatId);
    const seat = getSeatForSocket(room, socket.id);
    sendRack(io, room, seat);
    broadcastRoom(io, room);
    startTurnTimer(io, room);
    ack?.({ ok: true });
  }));

  socket.on('disconnect', (reason) => {
    log.info('socket.disconnect', { socketId: socket.id, reason });
    rateLimiter.forget(socket.id);
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

    const disc = roomManager.handleDisconnect(roomId, socket.id, (graceResult) => {
      if (!graceResult) return;
      const room = roomManager.getRoom(roomId);
      if (graceResult.deleted) return;
      io.to(roomId).emit(EVENTS.PLAYER_LEFT, { seatId: graceResult.seatId });
      if (room) {
        broadcastRoom(io, room);
        if (room.gameState.status === 'finished') {
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