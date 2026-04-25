import { customAlphabet } from 'nanoid';
import { MAX_PLAYERS, ROOM_TTL_MS, RECONNECT_GRACE_MS } from '../events.js';
import { initializeGame } from '../game/gameEngine.js';
import { roomStore } from './roomStore.js';
import { log } from '../logger.js';

const generateRoomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} in-memory cache; DB is source of truth */
    this.rooms = new Map();
  }

  /**
   * Boot-time hydration: load active rooms from DB into memory.
   * Called once from index.js after DB connects.
   */
  async hydrate() {
    const rows = await roomStore.loadActiveRooms();
    for (const room of rows) this.rooms.set(room.id, room);
    log.info('rooms.hydrate', { count: rows.length });
  }

  // ============================================================
  // CREATE
  // ============================================================
  async createRoom(hostSeat) {
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
      mode: 'private',
    };

    this.rooms.set(roomId, room);

    // Persist
    await roomStore.createRoom(room).catch((err) => {
      log.error('roomStore.createRoom.fail', { err: String(err) });
      // If DB write fails, remove from cache to keep them in sync
      this.rooms.delete(roomId);
      throw err;
    });

    return room;
  }

  // ============================================================
  // JOIN
  // ============================================================
  async joinRoom(roomId, seat) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.gameState.status !== 'waiting') return { error: 'Game already started' };
    if (room.players.length >= MAX_PLAYERS) return { error: 'Room is full' };
    if (room.players.some((p) => p.name.toLowerCase() === seat.name.toLowerCase())) {
      return { error: 'Name already taken in this room' };
    }

    const position = room.players.length;
    room.players.push(seat);
    this.touch(room);

    await roomStore.addSeat(roomId, seat, position).catch((err) => {
      log.error('roomStore.addSeat.fail', { err: String(err) });
      // Roll back in-memory if DB write failed
      room.players = room.players.filter((p) => p.seatId !== seat.seatId);
      throw err;
    });

    return { room };
  }

  // ============================================================
  // REJOIN (reconnection)
  // ============================================================
  async rejoinRoom(roomId, seatId, newSocketId) {
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

    await roomStore.updateSeatConnection(seatId, {
      socketId: newSocketId, connected: true,
    }).catch((err) => log.warn('roomStore.updateSeatConnection.fail', { err: String(err) }));

    return { room };
  }

  // ============================================================
  // DISCONNECT
  // ============================================================
  handleDisconnect(roomId, socketId, onGraceExpire) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const seat = room.players.find((p) => p.socketId === socketId);
    if (!seat) return null;

    seat.connected = false;
    seat.socketId = null;

    // Fire-and-forget DB update
    roomStore.updateSeatConnection(seat.seatId, { socketId: null, connected: false })
      .catch((err) => log.warn('roomStore.updateSeatConnection.fail', { err: String(err) }));

    // Waiting lobby: leave immediately
    if (room.gameState.status === 'waiting') {
      this.removeSeat(roomId, seat.seatId)
        .catch((err) => log.error('removeSeat.fail', { err: String(err) }));
      return { softDisconnect: false, room, seatId: seat.seatId };
    }

    const existing = room.pendingDisconnects.get(seat.seatId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      const result = await this.removeSeat(roomId, seat.seatId);
      if (onGraceExpire) onGraceExpire(result);
    }, RECONNECT_GRACE_MS);

    room.pendingDisconnects.set(seat.seatId, timer);
    this.touch(room);
    return { softDisconnect: true, room, seatId: seat.seatId };
  }

  // ============================================================
  // REMOVE SEAT
  // ============================================================
  async removeSeat(roomId, seatId) {
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

    await Promise.all([
      roomStore.removeSeat(seatId),
      roomStore.updateRoomState(roomId, {
        status: room.gameState.status,
        hostSeatId: room.hostSeatId,
        currentTurnSeatId: room.currentTurnSeatId,
        turnOrder: room.turnOrder,
        gameState: this.serializeGameState(room.gameState),
      }),
    ]).catch((err) => log.error('removeSeat.persist.fail', { err: String(err) }));

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
    // Async DB delete; cascade handles seats and moves
    roomStore.deleteRoom(roomId).catch((err) => log.warn('roomStore.deleteRoom.fail', { err: String(err) }));
  }

  // ============================================================
  // SPECTATORS (not persisted)
  // ============================================================
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
    room.spectators = room.spectators.filter((s) => s.socketId !== socketId);
    this.touch(room);
    return { room };
  }

  // ============================================================
  // GAME LIFECYCLE
  // ============================================================
  async startGame(roomId, requesterSeatId) {
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

    // Persist game start: each seat gets its rack saved
    await Promise.all([
      ...room.players.map((p) =>
        roomStore.updateSeatRack(p.seatId, room.gameState.racks[p.seatId] || [])
      ),
      roomStore.updateRoomState(roomId, {
        status: 'in_progress',
        currentTurnSeatId: room.currentTurnSeatId,
        turnOrder: room.turnOrder,
        turnNumber: room.gameState.turnNumber,
        isFirstMove: room.gameState.isFirstMove,
        gameState: this.serializeGameState(room.gameState),
      }),
    ]).catch((err) => log.error('startGame.persist.fail', { err: String(err) }));

    return { room };
  }

  async updateGameState(roomId, newGameState, nextSeatId, lastMove) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.gameState = newGameState;
    room.currentTurnSeatId = nextSeatId;
    this.touch(room);

    // Persist: room snapshot + per-seat racks/scores + new move row
    const seatUpdates = Object.entries(newGameState.racks || {}).map(([seatId, rack]) =>
      roomStore.updateSeatRack(seatId, rack)
    );
    const scoreUpdates = Object.entries(newGameState.scores || {}).map(([seatId, score]) =>
      roomStore.updateSeatScore(seatId, score)
    );

    const writes = [
      ...seatUpdates,
      ...scoreUpdates,
      roomStore.updateRoomState(roomId, {
        status: newGameState.status,
        currentTurnSeatId: nextSeatId,
        turnOrder: room.turnOrder,
        turnNumber: newGameState.turnNumber,
        consecutivePasses: newGameState.consecutivePasses,
        isFirstMove: newGameState.isFirstMove,
        gameState: this.serializeGameState(newGameState),
        finishedAt: newGameState.status === 'finished' ? new Date() : undefined,
      }),
    ];
    if (lastMove) {
      const seat = room.players.find((p) => p.seatId === lastMove.seatId);
      writes.push(roomStore.recordMove({
        roomId,
        seatId: lastMove.seatId,
        userId: seat?.userId || null,
        turn: lastMove.turn,
        type: lastMove.type,
        placements: lastMove.placements,
        words: lastMove.words,
        score: lastMove.score || 0,
      }));
    }

    Promise.all(writes).catch((err) => log.error('updateGameState.persist.fail', { err: String(err) }));

    return room;
  }

  // ============================================================
  // HELPERS
  // ============================================================
  touch(room) {
    room.lastActivityAt = Date.now();
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  serializeGameState(gs) {
    // Strip stuff we don't want in JSON (the racks live in seat rows)
    return {
      board: gs.board,
      bag: gs.bag,
      moveHistory: gs.moveHistory,
    };
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

  async sweepAbandoned() {
    const now = Date.now();
    const toDelete = [];
    for (const [id, room] of this.rooms.entries()) {
      const anyConnected = room.players.some((p) => p.connected) || (room.spectators?.length > 0);
      if (!anyConnected && (now - room.lastActivityAt) > ROOM_TTL_MS) {
        toDelete.push(id);
      }
    }
    toDelete.forEach((id) => this.destroyRoom(id));

    // Also clean up old finished rooms in DB (older than 7 days)
    const dbCleaned = await roomStore.sweepFinishedRooms(7 * 24 * 60 * 60 * 1000)
      .catch(() => 0);

    return toDelete.length + dbCleaned;
  }
}

export const roomManager = new RoomManager();