import { decideBotAction } from './botPlayer.js';
import { applyMove, passTurn, swapTiles } from '../game/gameEngine.js';
import { roomManager } from '../rooms/roomManager.js';
import { log } from '../logger.js';

/**
 * The bot scheduler watches each room's current turn. If the seat whose turn
 * it is happens to be a bot, after a small "thinking" delay it runs the
 * bot logic and applies the chosen action via the same code paths that
 * humans use (applyMove / passTurn / swapTiles).
 *
 * We expose a single function `maybeRunBotTurn(io, roomId)` that the socket
 * layer should call:
 *   - immediately after a game starts
 *   - after every successful move/pass/swap
 *
 * The scheduler is stateless — it just looks at the current turn and acts.
 */

const BOT_THINK_MIN_MS = 1200;
const BOT_THINK_MAX_MS = 2600;

// Per-room timers so we don't double-schedule
const pending = new Map();

export function maybeRunBotTurn(io, roomId, helpers) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  if (room.gameState.status !== 'in_progress') return;

  const currentSeat = room.players.find((p) => p.seatId === room.currentTurnSeatId);
  if (!currentSeat || !currentSeat.isBot) return;

  // Already scheduled?
  if (pending.has(roomId)) return;

  const delay = BOT_THINK_MIN_MS + Math.random() * (BOT_THINK_MAX_MS - BOT_THINK_MIN_MS);
  const timer = setTimeout(() => {
    pending.delete(roomId);
    runBotTurn(io, roomId, helpers).catch((err) =>
      log.error('bot.run.exception', { err: String(err), stack: err?.stack })
    );
  }, delay);
  pending.set(roomId, timer);
}

export function cancelBotForRoom(roomId) {
  const t = pending.get(roomId);
  if (t) {
    clearTimeout(t);
    pending.delete(roomId);
  }
}

async function runBotTurn(io, roomId, helpers) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  if (room.gameState.status !== 'in_progress') return;

  const seatId = room.currentTurnSeatId;
  const seat = room.players.find((p) => p.seatId === seatId);
  if (!seat?.isBot) return;

  const decision = decideBotAction(room, seatId);
  log.info('bot.decision', { roomId, seatId, action: decision.action, difficulty: seat.botDifficulty });

  let result, moveType;
  if (decision.action === 'move') {
    result = applyMove(room, seatId, decision.placements);
    moveType = 'move';
  } else if (decision.action === 'swap') {
    result = swapTiles(room, seatId, decision.tiles);
    moveType = 'swap';
  } else {
    result = passTurn(room, seatId);
    moveType = 'pass';
  }

  if (!result.ok) {
    // Fall back to pass if generator gave us something the validator hates
    log.warn('bot.action.rejected', {
      roomId, seatId, action: decision.action, error: result.error,
    });
    result = passTurn(room, seatId);
    moveType = 'pass';
    if (!result.ok) {
      log.error('bot.fallback.pass.failed', { roomId, seatId, error: result.error });
      return;
    }
  }

  await roomManager.updateGameState(roomId, result.newGameState, result.nextSeatId, {
    seatId,
    turn: result.newGameState.turnNumber - 1,
    type: moveType,
    placements: moveType === 'move' ? decision.placements : null,
    words: moveType === 'move' ? result.words : null,
    score: moveType === 'move' ? result.score : 0,
  });

  // Notify the room — we expose helpers through the helpers param so
  // we don't have to import socketHandlers here (would be a circular import).
  if (moveType === 'move') {
    io.to(roomId).emit('move_applied', {
      seatId,
      placements: decision.placements,
      score: result.score,
      words: result.words,
    });
  }

  helpers.broadcastRoom(io, room);
  helpers.sendAllRacks(io, room);

  if (result.newGameState.status === 'finished') {
    await helpers.updateUserStatsOnGameEnd(room, result.newGameState).catch(() => {});
    io.to(roomId).emit('game_ended', {
      reason: result.endReason,
      finalScores: result.newGameState.scores,
    });
    helpers.cancelTurnTimer(room);
    return;
  }

  helpers.startTurnTimer(io, room);

  // Chain: maybe the next player is also a bot
  maybeRunBotTurn(io, roomId, helpers);
}