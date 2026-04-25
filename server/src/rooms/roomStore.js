import { prisma } from '../db.js';

/**
 * RoomStore: thin Prisma wrapper.
 * RoomManager (in-memory cache) calls into this to persist mutations.
 *
 * IMPORTANT: shape conversions
 *  - DB stores `gameState` as JSON: { board, bag, racks, scores, moveHistory, ... }
 *  - DB stores seats in their own table; we hydrate them into room.players when loading
 *  - DB stores moves in their own table; in-memory `gameState.moveHistory` mirrors it
 *
 * The in-memory `room` shape stays exactly what Phases 1-4 used so socket handlers
 * don't change. We just sync to disk on every mutation.
 */

export const roomStore = {
  async createRoom(room) {
    return prisma.room.create({
      data: {
        id: room.id,
        hostUserId: null,
        hostSeatId: room.hostSeatId,
        status: 'waiting',
        mode: 'private',
        gameState: serializeGameState(room.gameState),
        currentTurnSeatId: null,
        turnOrder: [],
        turnNumber: 0,
        seats: {
          create: room.players.map((p, idx) => ({
            id: p.seatId,
            userId: p.userId || null,
            name: p.name,
            position: idx,
            isBot: !!p.isBot,
            socketId: p.socketId || null,
            connected: !!p.connected,
            rack: [],
          })),
        },
      },
      include: { seats: true },
    });
  },

  async addSeat(roomId, seat, position) {
    return prisma.seat.create({
      data: {
        id: seat.seatId,
        roomId,
        userId: seat.userId || null,
        name: seat.name,
        position,
        isBot: !!seat.isBot,
        socketId: seat.socketId || null,
        connected: !!seat.connected,
        rack: [],
      },
    });
  },

  async removeSeat(seatId) {
    await prisma.seat.update({
      where: { id: seatId },
      data: { leftAt: new Date(), connected: false, socketId: null },
    });
  },

  async updateSeatConnection(seatId, { socketId, connected }) {
    return prisma.seat.update({
      where: { id: seatId },
      data: { socketId, connected },
    });
  },

  async updateSeatRack(seatId, rack) {
    return prisma.seat.update({
      where: { id: seatId },
      data: { rack },
    });
  },

  async updateSeatScore(seatId, score) {
    return prisma.seat.update({
      where: { id: seatId },
      data: { score },
    });
  },

  async updateRoomState(roomId, patch) {
    return prisma.room.update({
      where: { id: roomId },
      data: {
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.hostSeatId !== undefined && { hostSeatId: patch.hostSeatId }),
        ...(patch.currentTurnSeatId !== undefined && { currentTurnSeatId: patch.currentTurnSeatId }),
        ...(patch.turnOrder !== undefined && { turnOrder: patch.turnOrder }),
        ...(patch.turnNumber !== undefined && { turnNumber: patch.turnNumber }),
        ...(patch.consecutivePasses !== undefined && { consecutivePasses: patch.consecutivePasses }),
        ...(patch.isFirstMove !== undefined && { isFirstMove: patch.isFirstMove }),
        ...(patch.gameState !== undefined && { gameState: patch.gameState }),
        ...(patch.finishedAt !== undefined && { finishedAt: patch.finishedAt }),
        lastActivityAt: new Date(),
      },
    });
  },

  async recordMove(move) {
    return prisma.move.create({
      data: {
        roomId: move.roomId,
        seatId: move.seatId,
        userId: move.userId || null,
        turn: move.turn,
        type: move.type,
        placements: move.placements || null,
        words: move.words || null,
        score: move.score || 0,
      },
    });
  },

  async deleteRoom(roomId) {
    // Cascades to seats and moves via the schema's onDelete: Cascade
    await prisma.room.delete({ where: { id: roomId } }).catch(() => {});
  },

  /**
   * Load all active (not finished) rooms on server boot.
   * Returns an array of in-memory shaped rooms.
   */
  async loadActiveRooms() {
    const rows = await prisma.room.findMany({
      where: { status: { in: ['waiting', 'in_progress'] } },
      include: { seats: { orderBy: { position: 'asc' } } },
    });
    return rows.map(rowToInMemoryRoom);
  },

  async sweepFinishedRooms(olderThanMs) {
    const cutoff = new Date(Date.now() - olderThanMs);
    const result = await prisma.room.deleteMany({
      where: {
        status: { in: ['finished', 'abandoned'] },
        lastActivityAt: { lt: cutoff },
      },
    });
    return result.count;
  },
};

// ----------------------------------------------------------------------
// Conversions
// ----------------------------------------------------------------------

function serializeGameState(gs) {
  // Anything in `gs` that isn't a Date / nested object goes straight to JSON.
  // We deliberately store everything together (board, bag, racks, scores)
  // because they're always read/written as a unit per turn.
  return gs || {};
}

export function rowToInMemoryRoom(row) {
  // Reconstruct the in-memory shape used by the rest of the codebase.
  return {
    id: row.id,
    hostSeatId: row.hostSeatId,
    players: row.seats
      .filter((s) => !s.leftAt)
      .map((s) => ({
        seatId: s.id,
        userId: s.userId,
        socketId: null,        // sockets reconnect after restart with a token
        name: s.name,
        connected: false,      // marked connected when they actually rejoin
        isBot: s.isBot,
      })),
    spectators: [],            // spectators are not persisted (ephemeral)
    gameState: {
      status: row.status,
      board: row.gameState?.board ?? null,
      bag: row.gameState?.bag ?? null,
      racks: Object.fromEntries(
        row.seats.filter((s) => !s.leftAt).map((s) => [s.id, s.rack || []])
      ),
      scores: Object.fromEntries(
        row.seats.filter((s) => !s.leftAt).map((s) => [s.id, s.score || 0])
      ),
      turnNumber: row.turnNumber,
      consecutivePasses: row.consecutivePasses,
      moveHistory: row.gameState?.moveHistory ?? [],
      isFirstMove: row.isFirstMove,
    },
    currentTurnSeatId: row.currentTurnSeatId,
    turnOrder: row.turnOrder || [],
    createdAt: row.createdAt.getTime(),
    lastActivityAt: row.lastActivityAt.getTime(),
    pendingDisconnects: new Map(),
    turnTimer: null,
    mode: row.mode,
  };
}