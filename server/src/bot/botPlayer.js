import { generateAllMoves } from './moveGenerator.js';
import { validateMove } from '../game/moveValidator.js';
import { log } from '../logger.js';

/**
 * Difficulty configuration:
 *
 *   easy:    plays a low-scoring move; sometimes passes/swaps even with valid options
 *   medium:  plays a middle-tier move
 *   hard:    plays the top move 85% of the time, second-best 15% (small variety)
 */
const DIFFICULTY = {
  easy: {
    pickMove(scored) {
      if (scored.length === 0) return null;
      // Bottom 50% of moves
      const half = Math.max(1, Math.floor(scored.length / 2));
      const pool = scored.slice(-half);
      return pool[Math.floor(Math.random() * pool.length)];
    },
    // 20% chance to skip its turn even with options (occasional dumb)
    occasionalPass: 0.2,
  },
  medium: {
    pickMove(scored) {
      if (scored.length === 0) return null;
      // Middle third of moves, clamped
      const lo = Math.floor(scored.length / 3);
      const hi = Math.floor((scored.length * 2) / 3);
      const pool = scored.slice(lo, Math.max(lo + 1, hi));
      return pool[Math.floor(Math.random() * pool.length)];
    },
    occasionalPass: 0.05,
  },
  hard: {
    pickMove(scored) {
      if (scored.length === 0) return null;
      // 85% top move, 15% second-best (if available)
      if (scored.length > 1 && Math.random() < 0.15) return scored[1];
      return scored[0];
    },
    occasionalPass: 0,
  },
};

/**
 * Decide what the bot should do this turn.
 *
 * @param {object} room - in-memory room object
 * @param {string} seatId - bot's seat
 * @returns {{ action: 'move'|'pass'|'swap', placements?: Array, tiles?: Array }}
 */
export function decideBotAction(room, seatId) {
  const seat = room.players.find((p) => p.seatId === seatId);
  if (!seat || !seat.isBot) return { action: 'pass' };

  const difficulty = seat.botDifficulty || 'medium';
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium;

  const board = room.gameState.board;
  const rack = room.gameState.racks?.[seatId] || [];
  const isFirstMove = !!room.gameState.isFirstMove;

  if (rack.length === 0) {
    return { action: 'pass' };
  }

  // Generate candidates
  let candidates = [];
  try {
    candidates = generateAllMoves(board, rack, isFirstMove);
  } catch (err) {
    log.error('bot.generate.error', { err: String(err), seatId, difficulty });
    return { action: 'pass' };
  }

  // Score each candidate using the real validator. This is the safety net:
  // if the generator produced something invalid, the validator will reject it.
  const scored = [];
  for (const c of candidates) {
    const validation = validateMove(board, c.placements, isFirstMove);
    if (!validation.ok) continue;
    scored.push({
      placements: c.placements,
      score: validation.score,
      words: validation.words,
    });
  }
  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // No legal placements — try swap if bag has tiles, else pass.
    return decideFallback(room, seatId, rack);
  }

  // Random "dumb pass" for easy/medium
  if (cfg.occasionalPass && Math.random() < cfg.occasionalPass) {
    return decideFallback(room, seatId, rack);
  }

  const choice = cfg.pickMove(scored);
  if (!choice) return decideFallback(room, seatId, rack);

  return {
    action: 'move',
    placements: choice.placements.map((p) => ({
      row: p.row, col: p.col, letter: p.letter, blank: !!p.blank,
    })),
  };
}

function decideFallback(room, seatId, rack) {
  const bagSize = room.gameState.bag?.length || 0;
  if (bagSize >= 7 && rack.length > 0) {
    // Swap the worst tiles. Keep vowels, drop consonant-heavy clutter.
    const tilesToSwap = pickTilesToSwap(rack);
    if (tilesToSwap.length > 0) {
      return { action: 'swap', tiles: tilesToSwap };
    }
  }
  return { action: 'pass' };
}

function pickTilesToSwap(rack) {
  // Heuristic: swap up to 3 high-value or duplicate consonants
  const counts = new Map();
  for (const t of rack) counts.set(t, (counts.get(t) || 0) + 1);
  const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
  const swappable = [];
  // Drop letters with >1 copy first (duplicates are usually a rack stinker)
  for (const [letter, c] of counts.entries()) {
    if (letter === '_') continue; // never swap blanks
    if (c > 1) {
      for (let i = 0; i < c - 1; i++) swappable.push(letter);
    }
  }
  // Then drop anything that isn't a vowel if we have <2 vowels
  const vowelCount = rack.filter((t) => VOWELS.has(t)).length;
  if (vowelCount < 2) {
    for (const t of rack) {
      if (!VOWELS.has(t) && t !== '_' && !swappable.includes(t)) {
        swappable.push(t);
        if (swappable.length >= 3) break;
      }
    }
  }
  return swappable.slice(0, 3);
}