import { EVENTS, RECONNECT_GRACE_MS } from '../events.js';
import { roomManager } from '../rooms/roomManager.js';
import { reconnectTokens } from '../rooms/reconnectTokens.js';
import { applyMove, passTurn, swapTiles } from '../game/gameEngine.js';
import { TurnTimer } from '../game/turnTimer.js';
import { createSocketRateLimiter } from '../middleware/rateLimiter.js';
import { randomBytes } from 'crypto';

const rateLimiter = createSocketRateLimiter({ capacity: 15, refillMs: 1000 });

function newSeatId() {
  return randomBytes(8).toString('hex');
}

/**
 * Public view of a room — never includes racks or bag contents.
 * Uses seat info (name, connected, hostSeatId) so the UI can show who's who.
 */
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

// Helper: gated acknowledge — wraps handler with rate-limit + try/catch
function gate(socket, fn) {
  return async (...args) => {
    const ack = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    if (!rateLimiter.allow(socket.id)) {
      return ack?.({ ok: false, error: 'Too many requests. Slow down.' });
    }
    try {
      await fn(...args);
    } catch (err) {
      console.error('[handler error]', err);
      ack?.({ ok: false, error: 'Internal error' });
    }
  };
}

export function registerSocketHandlers(io, socket) {
  // ---------- CREATE ROOM ----------
  socket.on(EVENTS.CREATE_ROOM, gate(socket, ({ playerName }, ack) => {
    const name = String(playerName || '').trim().slice(0, 20);
    if (!name) return ack?.({ ok: false, error: 'Player name is required' });

    const seatId = newSeatId();
    const seat = { seatId, socketId: socket.id, name, connected: true };
    const room = roomManager.createRoom(seat);

    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.seatId = seatId;

    const reconnectToken = reconnectTokens.issue(room.id, seatId, name, RECONNECT_GRACE_MS);
    ack?.({ ok: true, room: publicRoomView(room), seatId, reconnectToken });
    broadcastRoom(io, room);
  }));

  // ---------- JOIN ROOM ----------
  socket.on(EVENTS.JOIN_ROOM, gate(socket, ({ roomId, playerName }, ack) => {
    const id = String(roomId || '').trim().toUpperCase();
    const name = String(playerName || '').trim().slice(0, 20);
    if (!id || !name) return ack?.({ ok: false, error: 'Room ID and name are required' });

    const seatId = newSeatId();
    const seat = { seatId, socketId: socket.id, name, connected: true };
    const result = roomManager.joinRoom(id, seat);
    if (result.error) return ack?.({ ok: false, error: result.error });

    socket.join(id);
    socket.data.roomId = id;
    socket.data.seatId = seatId;

    const reconnectToken = reconnectTokens.issue(id, seatId, name, RECONNECT_GRACE_MS);
    ack?.({ ok: true, room: publicRoomView(result.room), seatId, reconnectToken });
    io.to(id).emit(EVENTS.PLAYER_JOINED, { player: { seatId, name } });
    broadcastRoom(io, result.room);
  }));

  // ---------- REJOIN (reconnection) ----------
  socket.on(EVENTS.REJOIN_ROOM, gate(socket, ({ reconnectToken }, ack) => {
    if (!reconnectToken) return ack?.({ ok: false, error: 'Missing reconnect token' });
    const record = reconnectTokens.consume(reconnectToken);
    if (!record) return ack?.({ ok: false, error: 'Reconnect token expired or invalid' });

    const result = roomManager.rejoinRoom(record.roomId, record.seatId, socket.id);
    if (result.error) return ack?.({ ok: false, error: result.error });

    socket.join(record.roomId);
    socket.data.roomId = record.roomId;
    socket.data.seatId = record.seatId;

    // Issue a fresh token for the next possible disconnect
    const newToken = reconnectTokens.issue(record.roomId, record.seatId, record.name, RECONNECT_GRACE_MS);

    ack?.({
      ok: true,
      room: publicRoomView(result.room),
      seatId: record.seatId,
      reconnectToken: newToken,
    });

    // Private rack re-send to the reconnected player
    const seat = result.room.players.find((p) => p.seatId === record.seatId);
    sendRack(io, result.room, seat);

    io.to(record.roomId).emit(EVENTS.PLAYER_RECONNECTED, { seatId: record.seatId, name: record.name });
    broadcastRoom(io, result.room);

    // If it's this player's turn, resume their timer
    if (
      result.room.gameState.status === 'in_progress' &&
      result.room.currentTurnSeatId === record.seatId
    ) {
      startTurnTimer(io, result.room);
    }
  }));

  // ---------- LEAVE ----------
  socket.on(EVENTS.LEAVE_ROOM, gate(socket, (_p, ack) => {
    const roomId = socket.data.roomId;
    const seatId = socket.data.seatId;
    if (roomId && seatId) {
      const room = roomManager.getRoom(roomId);
      if (room) {
        const res = roomManager.removeSeat(roomId, seatId);
        socket.leave(roomId);
        socket.data.roomId = null;
        socket.data.seatId = null;
        if (res && !res.deleted) {
          io.to(roomId).emit(EVENTS.PLAYER_LEFT, { seatId });
          broadcastRoom(io, res.room);
        }
      }
    }
    ack?.({ ok: true });
  }));

  // ---------- START GAME ----------
  socket.on(EVENTS.START_GAME, gate(socket, (_p, ack) => {
    const roomId = socket.data.roomId;
    const seatId = socket.data.seatId;
    if (!roomId || !seatId) return ack?.({ ok: false, error: 'Not in a room' });

    const result = roomManager.startGame(roomId, seatId);
    if (result.error) return ack?.({ ok: false, error: result.error });

    const room = result.room;
    sendAllRacks(io, room);
    io.to(roomId).emit(EVENTS.GAME_STARTED, publicRoomView(room));
    broadcastRoom(io, room);
    startTurnTimer(io, room);
    ack?.({ ok: true });
  }));

  // ---------- SUBMIT MOVE ----------
  socket.on(EVENTS.SUBMIT_MOVE, gate(socket, ({ placements }, ack) => {
    const roomId = socket.data.roomId;
    const seatId = socket.data.seatId;
    const room = roomManager.getRoom(roomId);
    if (!room || !seatId) return ack?.({ ok: false, error: 'Room not found' });

    const result = applyMove(room, seatId, placements || []);
    if (!result.ok) {
      // Atomic rejection: no state changed, tell only this player
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
      seatId,
      placements,
      score: result.score,
      words: result.words,
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

  // ---------- PASS ----------
  socket.on(EVENTS.PASS_TURN, gate(socket, (_p, ack) => {
    const roomId = socket.data.roomId;
    const seatId = socket.data.seatId;
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

  // ---------- SWAP ----------
  socket.on(EVENTS.SWAP_TILES, gate(socket, ({ tiles }, ack) => {
    const roomId = socket.data.roomId;
    const seatId = socket.data.seatId;
    const room = roomManager.getRoom(roomId);
    if (!room || !seatId) return ack?.({ ok: false, error: 'Room not found' });

    const result = swapTiles(room, seatId, tiles || []);
    if (!result.ok) return ack?.({ ok: false, error: result.error });

    roomManager.updateGameState(roomId, result.newGameState, result.nextSeatId);
    const seat = getSeatForSocket(room, socket.id);
    sendRack(io, room, seat);
    broadcastRoom(io, room);
    startTurnTimer(io, room);
    ack?.({ ok: true });
  }));

  // ---------- DISCONNECT ----------
  socket.on('disconnect', (reason) => {
    console.log(`[disconnect] ${socket.id} (${reason})`);
    rateLimiter.forget(socket.id);
    const roomId = socket.data.roomId;
    if (!roomId) return;

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
      // Tell everyone this player is temporarily disconnected (don't remove yet)
      io.to(roomId).emit(EVENTS.PLAYER_DISCONNECTED, { seatId: disc.seatId });
      broadcastRoom(io, room);
    } else if (!disc.deleted) {
      // Waiting-lobby disconnect: immediate remove
      io.to(roomId).emit(EVENTS.PLAYER_LEFT, { seatId: disc.seatId });
      broadcastRoom(io, room);
    }
  });
}