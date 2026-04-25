import { customAlphabet } from 'nanoid';
import { MAX_PLAYERS, ROOM_TTL_MS, RECONNECT_GRACE_MS } from '../events.js';
import { initializeGame } from '../game/gameEngine.js';

const generateRoomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(hostSeat) {
    let roomId = generateRoomCode();
    while (this.rooms.has(roomId)) roomId = generateRoomCode();

    const room = {
      id: roomId,
      hostSeatId: hostSeat.seatId,
      players: [hostSeat],
      spectators: [],
      gameState: {
        status: 'waiting',
        board: null,
        bag: null,
        racks: {},
        scores: {},
        turnNumber: 0,
        consecutivePasses: 0,
        moveHistory: [],
        isFirstMove: true,
      },
      currentTurnSeatId: null,
      turnOrder: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      pendingDisconnects: new Map(),
      turnTimer: null,
    };

    this.rooms.set(roomId, room);
    return room;
  }

  touch(room) {
    room.lastActivityAt = Date.now();
  }

  joinRoom(roomId, seat) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.gameState.status !== 'waiting') return { error: 'Game already started' };
    if (room.players.length >= MAX_PLAYERS) return { error: 'Room is full' };
    if (room.players.some((p) => p.name.toLowerCase() === seat.name.toLowerCase())) {
      return { error: 'Name already taken in this room' };
    }
    room.players.push(seat);
    this.touch(room);
    return { room };
  }

  rejoinRoom(roomId, seatId, newSocketId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    const seat = room.players.find((p) => p.seatId === seatId);
    if (!seat) return { error: 'Seat not found (maybe already removed)' };
    seat.socketId = newSocketId;
    seat.connected = true;

    const pending = room.pendingDisconnects.get(seatId);
    if (pending) {
      clearTimeout(pending);
      room.pendingDisconnects.delete(seatId);
    }
    this.touch(room);
    return { room };
  }

  handleDisconnect(roomId, socketId, onGraceExpire) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const seat = room.players.find((p) => p.socketId === socketId);
    if (!seat) return null;

    seat.connected = false;
    seat.socketId = null;

    if (room.gameState.status === 'waiting') {
      return this.removeSeat(roomId, seat.seatId);
    }

    const existing = room.pendingDisconnects.get(seat.seatId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const result = this.removeSeat(roomId, seat.seatId);
      if (onGraceExpire) onGraceExpire(result);
    }, RECONNECT_GRACE_MS);

    room.pendingDisconnects.set(seat.seatId, timer);
    this.touch(room);
    return { softDisconnect: true, room, seatId: seat.seatId };
  }

  removeSeat(roomId, seatId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const wasCurrentTurn = room.currentTurnSeatId === seatId;
    room.players = room.players.filter((p) => p.seatId !== seatId);

    const pending = room.pendingDisconnects.get(seatId);
    if (pending) {
      clearTimeout(pending);
      room.pendingDisconnects.delete(seatId);
    }

    if (room.players.length === 0) {
      this.destroyRoom(roomId);
      return { room: null, deleted: true, seatId };
    }

    if (room.hostSeatId === seatId) {
      room.hostSeatId = room.players[0].seatId;
    }

    if (room.turnOrder.length > 0) {
      room.turnOrder = room.turnOrder.filter((id) => id !== seatId);
      if (room.gameState.status === 'in_progress' && room.turnOrder.length < 2) {
        room.gameState.status = 'finished';
      } else if (wasCurrentTurn && room.turnOrder.length > 0) {
        room.currentTurnSeatId = room.turnOrder[0];
      }
    }

    if (room.gameState.racks) delete room.gameState.racks[seatId];

    this.touch(room);
    return { room, deleted: false, seatId };
  }

  destroyRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const t of room.pendingDisconnects.values()) clearTimeout(t);
    if (room.turnTimer) {
      try { room.turnTimer.cancel(); } catch {}
    }
    this.rooms.delete(roomId);
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  startGame(roomId, requesterSeatId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.hostSeatId !== requesterSeatId) return { error: 'Only host can start the game' };
    if (room.players.length < 2) return { error: 'Need at least 2 players' };
    if (room.gameState.status !== 'waiting') return { error: 'Game already in progress' };

    const seatIds = room.players.map((p) => p.seatId);
    room.gameState = initializeGame(seatIds);
    room.turnOrder = seatIds;
    room.currentTurnSeatId = seatIds[0];
    this.touch(room);
    return { room };
  }

  updateGameState(roomId, newGameState, nextSeatId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.gameState = newGameState;
    room.currentTurnSeatId = nextSeatId;
    this.touch(room);
    return room;
  }

  stats() {
    return {
    totalRooms: this.rooms.size,
    totalPlayers: Array.from(this.rooms.values()).reduce((s, r) => s + r.players.length, 0),
    totalSpectators: Array.from(this.rooms.values()).reduce((s, r) => s + (r.spectators?.length || 0), 0),
    connectedPlayers: Array.from(this.rooms.values())
      .reduce((s, r) => s + r.players.filter((p) => p.connected).length, 0),
    };
  }
  

  sweepAbandoned() {
    const now = Date.now();
    const toDelete = [];
    for (const [id, room] of this.rooms.entries()) {
      const anyConnected = room.players.some((p) => p.connected) || (room.spectators?.length > 0);
      if (!anyConnected && (now - room.lastActivityAt) > ROOM_TTL_MS) {
        toDelete.push(id);
      }
    }
    toDelete.forEach((id) => this.destroyRoom(id));
    return toDelete.length;
  }
  // ---------- SPECTATORS ----------
  /**
   * Spectators don't take a seat. They join the socket.io room to receive
   * room_state broadcasts but never get a rack, score, or turn.
   */
  addSpectator(roomId, spectator) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (!room.spectators) room.spectators = [];
    if (room.spectators.length >= 20) return { error: 'Spectator limit reached' };
    if (room.spectators.some((s) => s.socketId === spectator.socketId)) return { room };
    room.spectators.push(spectator);
    this.touch(room);
    return { room };
  }

  removeSpectator(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (!room.spectators) return { room };
    const before = room.spectators.length;
    room.spectators = room.spectators.filter((s) => s.socketId !== socketId);
    if (before !== room.spectators.length) this.touch(room);
    return { room };
  }

  getSpectatorBySocketId(socketId) {
    for (const room of this.rooms.values()) {
      if (room.spectators?.some((s) => s.socketId === socketId)) return room;
    }
    return null;
  }
}

export const roomManager = new RoomManager();