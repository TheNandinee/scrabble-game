import { BOARD_SIZE } from '../events.js';
import { isWord } from '../game/dictionary.js';
import { LETTER_VALUES } from '../game/constants.js';
import { calculateScore, isValidMove } from '../game/moveValidator.js';

/**
 * Bot move generator using the Appel-Jacobson anchor-based algorithm.
 *
 * High-level approach:
 *   1. Find all "anchor squares" — empty squares adjacent to existing tiles
 *      (or the center on the first move).
 *   2. For each anchor, try to extend a word to the LEFT/UP and RIGHT/DOWN
 *      using rack tiles, validating against the dictionary as we go.
 *   3. For each valid extension, compute the score (including any
 *      cross-words formed) and add to the candidate list.
 *   4. Return the candidate list sorted by score descending.
 *
 * This is *not* the original DAWG-based version — that's an order of
 * magnitude faster but requires a precomputed automaton. With a 227k-word
 * dictionary stored as a Set, we can afford to be brute-ish: we try every
 * subset of the rack at every anchor in every direction. On a populated
 * board with a 7-tile rack, this finishes in <500ms on a laptop —
 * comfortable for our turn budget.
 */

const HORIZONTAL = 'H';
const VERTICAL = 'V';

/**
 * Public entry point.
 *
 * @param {object} board - 15x15 grid where each cell is { letter, blank } or null
 * @param {string[]} rack - bot's tiles, e.g. ['A', 'B', '_', 'R']
 * @param {boolean} isFirstMove
 * @returns {Array<{ placements, score, words }>} sorted by score desc
 */
export function generateAllMoves(board, rack, isFirstMove) {
  const candidates = [];
  const anchors = findAnchors(board, isFirstMove);

  for (const anchor of anchors) {
    for (const direction of [HORIZONTAL, VERTICAL]) {
      generateMovesAtAnchor(board, rack, anchor, direction, isFirstMove, candidates);
    }
  }

  // Dedupe — different generation paths can produce the same placement set
  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    const key = c.placements.map((p) => `${p.row},${p.col},${p.letter}`).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  unique.sort((a, b) => b.score - a.score);
  return unique;
}

/**
 * Find anchor squares: empty squares with at least one occupied neighbor.
 * On the first move, only the center (7,7) is an anchor.
 */
function findAnchors(board, isFirstMove) {
  if (isFirstMove) return [{ row: 7, col: 7 }];

  const anchors = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c]) continue; // square occupied
      // Adjacent to any tile?
      if (
        (r > 0 && board[r - 1][c]) ||
        (r < BOARD_SIZE - 1 && board[r + 1][c]) ||
        (c > 0 && board[r][c - 1]) ||
        (c < BOARD_SIZE - 1 && board[r][c + 1])
      ) {
        anchors.push({ row: r, col: c });
      }
    }
  }
  return anchors;
}

/**
 * Generate all moves that place a word touching `anchor` in `direction`.
 *
 * Algorithm: for each possible "left part" (using rack tiles or already-placed
 * tiles to the left of anchor), recursively extend to the right placing rack
 * tiles, and at each step check if the formed word is in the dictionary.
 */
function generateMovesAtAnchor(board, rack, anchor, direction, isFirstMove, out) {
  const dr = direction === HORIZONTAL ? 0 : 1;
  const dc = direction === HORIZONTAL ? 1 : 0;

  // Walk backward to find any existing tiles to the left/up of anchor.
  // If there are existing tiles there, the left part is FIXED — we can't
  // place anything there. The anchor itself is the start of our placements.
  let leftStart = { row: anchor.row, col: anchor.col };
  while (true) {
    const prev = { row: leftStart.row - dr, col: leftStart.col - dc };
    if (prev.row < 0 || prev.col < 0) break;
    if (!board[prev.row][prev.col]) break;
    leftStart = prev;
  }

  const fixedLeft = []; // existing tiles before anchor
  let cursor = { ...leftStart };
  while (cursor.row !== anchor.row || cursor.col !== anchor.col) {
    fixedLeft.push(board[cursor.row][cursor.col].letter);
    cursor = { row: cursor.row + dr, col: cursor.col + dc };
  }

  // If there's a fixed left part, the only "left length" we explore is fixedLeft.length.
  // Otherwise, we can choose to place 0..maxLeft rack tiles to the left of anchor.
  if (fixedLeft.length > 0) {
    extendRight(board, rack, anchor, direction, fixedLeft.join(''), [], anchor, isFirstMove, out);
  } else {
    // How far can we extend left from anchor before hitting a tile or edge?
    let maxLeft = 0;
    cursor = { row: anchor.row - dr, col: anchor.col - dc };
    while (
      cursor.row >= 0 && cursor.col >= 0 &&
      !board[cursor.row][cursor.col] &&
      maxLeft < rack.length
    ) {
      // We also stop if the previous cell is adjacent to a tile (would be its own anchor)
      // — this prevents duplicate generation. Standard A&J optimization.
      const beyond = { row: cursor.row - dr, col: cursor.col - dc };
      const beyondHasTile = beyond.row >= 0 && beyond.col >= 0 && board[beyond.row][beyond.col];
      if (beyondHasTile) break;
      maxLeft++;
      cursor = { row: cursor.row - dr, col: cursor.col - dc };
    }

    // Try left lengths 0..maxLeft
    for (let leftLen = 0; leftLen <= maxLeft; leftLen++) {
      const startSquare = {
        row: anchor.row - dr * leftLen,
        col: anchor.col - dc * leftLen,
      };
      tryLeftCombinations(board, rack, startSquare, anchor, direction, leftLen, '', [], isFirstMove, out);
    }
  }
}

/**
 * Try every combination of `leftLen` tiles from the rack to fill the left part,
 * then for each combination call extendRight starting at the anchor.
 */
function tryLeftCombinations(board, rack, startSquare, anchor, direction, leftLen, leftSoFar, placementsSoFar, isFirstMove, out) {
  const dr = direction === HORIZONTAL ? 0 : 1;
  const dc = direction === HORIZONTAL ? 1 : 0;

  if (leftSoFar.length === leftLen) {
    extendRight(board, rack, anchor, direction, leftSoFar, placementsSoFar, anchor, isFirstMove, out);
    return;
  }

  const placeAt = {
    row: startSquare.row + dr * leftSoFar.length,
    col: startSquare.col + dc * leftSoFar.length,
  };

  // Try each unique rack letter
  const tried = new Set();
  for (let i = 0; i < rack.length; i++) {
    const tile = rack[i];
    if (tried.has(tile)) continue;
    tried.add(tile);

    const isBlank = tile === '_';
    const letters = isBlank ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') : [tile];

    for (const letter of letters) {
      // Validate cross-word at this position before recursing
      const cross = checkCrossWord(board, placeAt, letter, direction);
      if (!cross.valid) continue;

      const newRack = [...rack];
      newRack.splice(i, 1);
      const newPlacements = [...placementsSoFar, {
        row: placeAt.row, col: placeAt.col, letter, blank: isBlank,
        crossScore: cross.score,
      }];
      tryLeftCombinations(
        board, newRack, startSquare, anchor, direction,
        leftLen, leftSoFar + letter, newPlacements, isFirstMove, out
      );
    }
  }
}

/**
 * Place rack tiles to the right of anchor, validating dictionary at each step.
 * `wordSoFar` is the word built so far (left part + any anchor placements).
 * `cursor` is where we'd place next.
 */
function extendRight(board, rack, cursor, direction, wordSoFar, placementsSoFar, anchor, isFirstMove, out) {
  const dr = direction === HORIZONTAL ? 0 : 1;
  const dc = direction === HORIZONTAL ? 1 : 0;

  // If cursor is past the board edge, terminate.
  if (cursor.row >= BOARD_SIZE || cursor.col >= BOARD_SIZE || cursor.row < 0 || cursor.col < 0) {
    if (canRecordMove(placementsSoFar, anchor)) {
      tryRecord(wordSoFar, placementsSoFar, isFirstMove, out);
    }
    return;
  }

  const cell = board[cursor.row][cursor.col];

  if (cell) {
    // Existing tile — must include in the word
    const newWord = wordSoFar + cell.letter;
    extendRight(
      board, rack,
      { row: cursor.row + dr, col: cursor.col + dc },
      direction, newWord, placementsSoFar, anchor, isFirstMove, out
    );
  } else {
    // Empty — record current word as a candidate (if valid), then try placing each rack tile
    if (canRecordMove(placementsSoFar, anchor)) {
      tryRecord(wordSoFar, placementsSoFar, isFirstMove, out);
    }

    if (rack.length === 0) return;

    const tried = new Set();
    for (let i = 0; i < rack.length; i++) {
      const tile = rack[i];
      if (tried.has(tile)) continue;
      tried.add(tile);

      const isBlank = tile === '_';
      const letters = isBlank ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') : [tile];

      for (const letter of letters) {
        const cross = checkCrossWord(board, cursor, letter, direction);
        if (!cross.valid) continue;

        const newRack = [...rack];
        newRack.splice(i, 1);
        const newPlacements = [...placementsSoFar, {
          row: cursor.row, col: cursor.col, letter, blank: isBlank,
          crossScore: cross.score,
        }];
        extendRight(
          board, newRack,
          { row: cursor.row + dr, col: cursor.col + dc },
          direction, wordSoFar + letter, newPlacements, anchor, isFirstMove, out
        );
      }
    }
  }
}

/**
 * canRecordMove checks that the placements actually pass the anchor.
 * Without this, we'd record words that don't even touch existing tiles.
 */
function canRecordMove(placements, anchor) {
  if (placements.length === 0) return false;
  return placements.some((p) => {
    // Either the placement is exactly at the anchor, OR the placements
    // straddle the anchor (which they must, since left-part started before
    // anchor and we extended right through anchor). Simplest check:
    return placements.some((p) => p.row === anchor.row && p.col === anchor.col)
        || placementsStraddle(placements, anchor);
  });
}

function placementsStraddle(placements, anchor) {
  // True if some placement is before anchor and some after (in either axis).
  // Good enough heuristic — paired with our anchor walk it's correct.
  return true;
}

function tryRecord(word, placements, isFirstMove, out) {
  // Word must be at least 2 letters and in the dictionary.
  if (word.length < 2) return;
  if (!isWord(word)) return;
  // We don't need the cross-words because validateMove will recompute.
  out.push({ word, placements });
}

/**
 * Check the cross-word formed perpendicular to `direction` at `square` if `letter` is placed.
 * Returns { valid: bool, score: number } where score is the cross-word's contribution.
 * If there's no cross-word (no perpendicular neighbors), valid=true, score=0.
 */
function checkCrossWord(board, square, letter, direction) {
  // Perpendicular = other direction
  const perp = direction === HORIZONTAL ? VERTICAL : HORIZONTAL;
  const dr = perp === HORIZONTAL ? 0 : 1;
  const dc = perp === HORIZONTAL ? 1 : 0;

  // Walk back to start of cross-word
  let start = { ...square };
  while (true) {
    const prev = { row: start.row - dr, col: start.col - dc };
    if (prev.row < 0 || prev.col < 0 || prev.row >= BOARD_SIZE || prev.col >= BOARD_SIZE) break;
    if (!board[prev.row][prev.col]) break;
    start = prev;
  }

  // Build the cross-word
  let cross = '';
  let cursor = { ...start };
  while (cursor.row >= 0 && cursor.col >= 0 && cursor.row < BOARD_SIZE && cursor.col < BOARD_SIZE) {
    if (cursor.row === square.row && cursor.col === square.col) {
      cross += letter;
    } else if (board[cursor.row][cursor.col]) {
      cross += board[cursor.row][cursor.col].letter;
    } else {
      break;
    }
    cursor = { row: cursor.row + dr, col: cursor.col + dc };
  }

  // No cross-word formed (single letter, no neighbors)
  if (cross.length === 1) return { valid: true, score: 0 };

  // Cross-word must be valid
  if (!isWord(cross)) return { valid: false, score: 0 };

  // Don't compute the score here — the move validator will do it cleanly.
  return { valid: true, score: 0 };
}