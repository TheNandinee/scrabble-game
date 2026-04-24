import { customAlphabet } from 'nanoid';
import { MAX_PLAYERS } from '../events.js';

// Short, readable room codes. Avoid 0/O/1/I ambiguity.
const generateRoomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

/**
 * Room Manager
 * - Holds all rooms in an in-memory Map keyed by roomId.
 * - Every mutation goes through a method here; no external code touches the Map.
 * - Each room is fully isolated: players, gameState, turn order live inside the room object only.
 */
class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
  }

  createRoom(hostPlayer) {
    // Collision-safe code generation
    let roomId = generateRoomCode();
    while (this.rooms.has(roomId)) {
      roomId = generateRoomCode();
    }

    const room = {
      id: roomId,
      hostId: hostPlayer.id,
      players: [hostPlayer],
      gameState: {
        status: 'waiting', // waiting | in_progress | finished
        board: null,
        tileBag: null,
        scores: {},
      },
      currentTurnPlayerId: null,
      turnOrder: [],
      createdAt: Date.now(),
    };

    this.rooms.set(roomId, room);
    return room;
  }

  joinRoom(roomId, player) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { error: 'Room not found' };
    }
    if (room.gameState.status !== 'waiting') {
      return { error: 'Game already started' };
    }
    if (room.players.length >= MAX_PLAYERS) {
      return { error: 'Room is full' };
    }
    if (room.players.some((p) => p.id === player.id)) {
      // Same socket re-joining — idempotent
      return { room };
    }
    if (room.players.some((p) => p.name.toLowerCase() === player.name.toLowerCase())) {
      return { error: 'Name already taken in this room' };
    }

    room.players.push(player);
    return { room };
  }

  leaveRoom(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const before = room.players.length;
    room.players = room.players.filter((p) => p.id !== playerId);

    if (room.players.length === 0) {
      // Clean up empty rooms immediately — no orphaned state.
      this.rooms.delete(roomId);
      return { room: null, deleted: true };
    }

    // Reassign host if host left
    if (room.hostId === playerId) {
      room.hostId = room.players[0].id;
    }

    // If it was this player's turn mid-game, pass to next
    if (room.currentTurnPlayerId === playerId && room.turnOrder.length > 0) {
      room.turnOrder = room.turnOrder.filter((id) => id !== playerId);
      if (room.turnOrder.length > 0) {
        room.currentTurnPlayerId = room.turnOrder[0];
      }
    }

    return { room, deleted: false, removedCount: before - room.players.length };
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  getRoomBySocketId(socketId) {
    for (const room of this.rooms.values()) {
      if (room.players.some((p) => p.id === socketId)) {
        return room;
      }
    }
    return null;
  }

  startGame(roomId, requesterId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.hostId !== requesterId) return { error: 'Only host can start the game' };
    if (room.players.length < 2) return { error: 'Need at least 2 players' };
    if (room.gameState.status !== 'waiting') return { error: 'Game already in progress' };

    room.gameState.status = 'in_progress';
    room.turnOrder = room.players.map((p) => p.id);
    room.currentTurnPlayerId = room.turnOrder[0];
    room.players.forEach((p) => {
      room.gameState.scores[p.id] = 0;
    });

    return { room };
  }

  // Stats for health/debug endpoint
  stats() {
    return {
      totalRooms: this.rooms.size,
      totalPlayers: Array.from(this.rooms.values()).reduce((sum, r) => sum + r.players.length, 0),
    };
  }
}

// Single instance exported. The Map inside is the only shared state, and it's keyed
// per room — there is no cross-room mutable state.
export const roomManager = new RoomManager();