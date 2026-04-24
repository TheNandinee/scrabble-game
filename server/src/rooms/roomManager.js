import { customAlphabet } from 'nanoid';
import { MAX_PLAYERS, ROOM_TTL_MS, RECONNECT_GRACE_MS } from '../events.js';
import { initializeGame } from '../game/gameEngine.js';

const generateRoomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

/**
 * Players have two IDs:
 *   - socketId: changes on every connection
 *   - seatId:   stable id for the logical player slot (what turn order is keyed on)
 *
 * Rooms hold `players`, each with { seatId, socketId (or null), name, connected }.
 * Racks, scores, turnOrder all key on seatId, not socketId.
 */
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
      // pending disconnects: seatId -> timeout id for grace-period removal
      pendingDisconnects: new Map(),
      // active turn timer (set by sockets layer)
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

  /**
   * Reconnect: player comes back with a valid seatId they already own in the room.
   * Updates their socketId and marks them connected. Returns the room.
   */
  rejoinRoom(roomId, seatId, newSocketId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    const seat = room.players.find((p) => p.seatId === seatId);
    if (!seat) return { error: 'Seat not found (maybe already removed)' };
    seat.socketId = newSocketId;
    seat.connected = true;

    // Cancel pending disconnect cleanup
    const pending = room.pendingDisconnects.get(seatId);
    if (pending) {
      clearTimeout(pending);
      room.pendingDisconnects.delete(seatId);
    }
    this.touch(room);
    return { room };
  }

  /**
   * Soft disconnect: mark the seat as disconnected but keep it in the room
   * until the grace period expires. Returns a description of what to do next.
   */
  handleDisconnect(roomId, socketId, onGraceExpire) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const seat = room.players.find((p) => p.socketId === socketId);
    if (!seat) return null;

    seat.connected = false;
    seat.socketId = null;

    // Waiting lobby: leave immediately (no rack/score to preserve)
    if (room.gameState.status === 'waiting') {
      return this.removeSeat(roomId, seat.seatId);
    }

    // In-progress / finished: keep seat for grace period
    const existing = room.pendingDisconnects.get(seat.seatId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      // Grace expired: actually remove them
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

    // Clear any pending timer
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
    // Clean up any pending timers so GC doesn't leak
    for (const t of room.pendingDisconnects.values()) clearTimeout(t);
    if (room.turnTimer) clearTimeout(room.turnTimer);
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
      connectedPlayers: Array.from(this.rooms.values())
        .reduce((s, r) => s + r.players.filter((p) => p.connected).length, 0),
    };
  }

  /**
   * Sweep abandoned rooms. Called on an interval from index.js.
   * A room is abandoned if: no activity for ROOM_TTL_MS AND no connected players.
   */
  sweepAbandoned() {
    const now = Date.now();
    const toDelete = [];
    for (const [id, room] of this.rooms.entries()) {
      const anyConnected = room.players.some((p) => p.connected);
      if (!anyConnected && (now - room.lastActivityAt) > ROOM_TTL_MS) {
        toDelete.push(id);
      }
    }
    toDelete.forEach((id) => this.destroyRoom(id));
    return toDelete.length;
  }
}

export const roomManager = new RoomManager();