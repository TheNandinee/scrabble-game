import { generateAllMoves } from './moveGenerator.js';
import { validatePlacement } from '../game/moveValidator.js';
import { scoreMove } from '../game/scoring.js';
import { cloneBoard } from '../game/board.js';
import { log } from '../logger.js';

/**
 * Difficulty profiles — same generator output, different selection strategies.
 *   easy:   bottom 50% of moves; 20% chance of voluntary pass
 *   medium: middle third
 *   hard:   top move 85% of the time, 2nd-best 15%
 */
const DIFFICULTY = {
  easy: {
    pickMove(scored) {
      if (scored.length === 0) return null;
      const half = Math.max(1, Math.floor(scored.length / 2));
      const pool = scored.slice(-half);
      return pool[Math.floor(Math.random() * pool.length)];
    },
    occasionalPass: 0.2,
  },
  medium: {
    pickMove(scored) {
      if (scored.length === 0) return null;
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
      if (scored.length > 1 && Math.random() < 0.15) return scored[1];
      return scored[0];
    },
    occasionalPass: 0,
  },
};

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

  let candidates = [];
  try {
    candidates = generateAllMoves(board, rack, isFirstMove);
  } catch (err) {
    log.error('bot.generate.error', { err: String(err), stack: err?.stack, seatId, difficulty });
    return { action: 'pass' };
  }

  // Score each candidate using the real validator + scoring functions.
  // This is the safety net: if the generator produced anything invalid,
  // validatePlacement rejects it and we skip it.
  const scored = [];
  for (const c of candidates) {
    // Geometry check on the EMPTY board state (validator expects this)
    const validation = validatePlacement(board, c.placements, rack, isFirstMove);
    if (!validation.ok) continue;

    // Apply placements to a cloned board so scoreMove sees the post-move state
    const newBoard = cloneBoard(board);
    for (const p of c.placements) {
      newBoard[p.row][p.col] = {
        letter: String(p.letter).toUpperCase(),
        seatId,
        blank: !!p.blank,
        placedOnTurn: room.gameState.turnNumber,
      };
    }

    const { total, words } = scoreMove(newBoard, c.placements);
    scored.push({
      placements: c.placements,
      score: total,
      words,
    });
  }
  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return decideFallback(room, rack);
  }

  if (cfg.occasionalPass && Math.random() < cfg.occasionalPass) {
    return decideFallback(room, rack);
  }

  const choice = cfg.pickMove(scored);
  if (!choice) return decideFallback(room, rack);

  return {
    action: 'move',
    placements: choice.placements.map((p) => ({
      row: p.row,
      col: p.col,
      letter: p.letter,
      blank: !!p.blank,
    })),
  };
}

function decideFallback(room, rack) {
  const bagSize = room.gameState.bag?.length || 0;
  if (bagSize >= 7 && rack.length > 0) {
    const tilesToSwap = pickTilesToSwap(rack);
    if (tilesToSwap.length > 0) {
      return { action: 'swap', tiles: tilesToSwap };
    }
  }
  return { action: 'pass' };
}

function pickTilesToSwap(rack) {
  const counts = new Map();
  for (const t of rack) counts.set(t, (counts.get(t) || 0) + 1);

  const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
  const swappable = [];

  // Prefer swapping duplicates (a rack of 3 I's is usually a stinker)
  for (const [letter, c] of counts.entries()) {
    if (letter === '_') continue; // never swap blanks
    if (c > 1) {
      for (let i = 0; i < c - 1; i++) swappable.push(letter);
    }
  }

  // If we're vowel-poor or consonant-heavy, dump some consonants
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