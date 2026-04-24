import { EVENTS, MIN_PLAYERS } from '../events.js';
import { roomManager } from '../rooms/roomManager.js';

/**
 * Build a client-safe view of the room. Never send internal server state
 * (like future tile bags / other players' racks) that a client shouldn't see.
 */
function publicRoomView(room) {
  if (!room) return null;
  return {
    id: room.id,
    hostId: room.hostId,
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
    status: room.gameState.status,
    currentTurnPlayerId: room.currentTurnPlayerId,
    turnOrder: room.turnOrder,
    scores: room.gameState.scores,
  };
}

export function registerSocketHandlers(io, socket) {
  // --- CREATE ROOM ---
  socket.on(EVENTS.CREATE_ROOM, ({ playerName }, ack) => {
    try {
      const name = String(playerName || '').trim().slice(0, 20);
      if (!name) {
        return ack?.({ ok: false, error: 'Player name is required' });
      }

      const player = { id: socket.id, name };
      const room = roomManager.createRoom(player);

      socket.join(room.id);
      socket.data.roomId = room.id;
      socket.data.playerName = name;

      const view = publicRoomView(room);
      ack?.({ ok: true, room: view });
      // Host is alone in the room, but emitting keeps the contract uniform.
      io.to(room.id).emit(EVENTS.ROOM_STATE, view);
    } catch (err) {
      console.error('[CREATE_ROOM] error:', err);
      ack?.({ ok: false, error: 'Internal error' });
    }
  });

  // --- JOIN ROOM ---
  socket.on(EVENTS.JOIN_ROOM, ({ roomId, playerName }, ack) => {
    try {
      const id = String(roomId || '').trim().toUpperCase();
      const name = String(playerName || '').trim().slice(0, 20);
      if (!id || !name) {
        return ack?.({ ok: false, error: 'Room ID and player name are required' });
      }

      const player = { id: socket.id, name };
      const result = roomManager.joinRoom(id, player);
      if (result.error) {
        return ack?.({ ok: false, error: result.error });
      }

      socket.join(id);
      socket.data.roomId = id;
      socket.data.playerName = name;

      const view = publicRoomView(result.room);
      ack?.({ ok: true, room: view });
      io.to(id).emit(EVENTS.PLAYER_JOINED, { player: { id: socket.id, name } });
      io.to(id).emit(EVENTS.ROOM_STATE, view);
    } catch (err) {
      console.error('[JOIN_ROOM] error:', err);
      ack?.({ ok: false, error: 'Internal error' });
    }
  });

  // --- LEAVE ROOM (explicit) ---
  socket.on(EVENTS.LEAVE_ROOM, (_payload, ack) => {
    handleLeave(io, socket);
    ack?.({ ok: true });
  });

  // --- START GAME (host only) ---
  socket.on(EVENTS.START_GAME, (_payload, ack) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return ack?.({ ok: false, error: 'Not in a room' });

      const result = roomManager.startGame(roomId, socket.id);
      if (result.error) return ack?.({ ok: false, error: result.error });

      const view = publicRoomView(result.room);
      io.to(roomId).emit(EVENTS.GAME_STARTED, view);
      io.to(roomId).emit(EVENTS.ROOM_STATE, view);
      ack?.({ ok: true, room: view });
    } catch (err) {
      console.error('[START_GAME] error:', err);
      ack?.({ ok: false, error: 'Internal error' });
    }
  });

  // --- DISCONNECT ---
  socket.on('disconnect', (reason) => {
    console.log(`[disconnect] ${socket.id} (${reason})`);
    handleLeave(io, socket);
  });
}

function handleLeave(io, socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const result = roomManager.leaveRoom(roomId, socket.id);
  socket.leave(roomId);
  socket.data.roomId = null;

  if (!result) return;

  if (result.deleted) {
    // Room was destroyed; nothing to emit.
    return;
  }

  const view = {
    id: result.room.id,
    hostId: result.room.hostId,
    players: result.room.players.map((p) => ({ id: p.id, name: p.name })),
    status: result.room.gameState.status,
    currentTurnPlayerId: result.room.currentTurnPlayerId,
    turnOrder: result.room.turnOrder,
    scores: result.room.gameState.scores,
  };

  io.to(roomId).emit(EVENTS.PLAYER_LEFT, { playerId: socket.id });
  io.to(roomId).emit(EVENTS.ROOM_STATE, view);
}