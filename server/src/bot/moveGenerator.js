import { BOARD_SIZE } from '../events.js';
import { isValidWord } from '../game/dictionary.js';

const HORIZONTAL = 'H';
const VERTICAL = 'V';

export function generateAllMoves(board, rack, isFirstMove) {
  const candidates = [];
  const anchors = findAnchors(board, isFirstMove);

  for (const anchor of anchors) {
    for (const direction of [HORIZONTAL, VERTICAL]) {
      generateMovesAtAnchor(board, rack, anchor, direction, isFirstMove, candidates);
    }
  }

  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    const key = c.placements
      .map((p) => `${p.row},${p.col},${p.letter},${p.blank ? 1 : 0}`)
      .sort()
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  return unique;
}

function findAnchors(board, isFirstMove) {
  if (isFirstMove) return [{ row: 7, col: 7 }];

  const anchors = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c]) continue;
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

function generateMovesAtAnchor(board, rack, anchor, direction, isFirstMove, out) {
  const dr = direction === HORIZONTAL ? 0 : 1;
  const dc = direction === HORIZONTAL ? 1 : 0;

  let leftStart = { row: anchor.row, col: anchor.col };
  while (true) {
    const prev = { row: leftStart.row - dr, col: leftStart.col - dc };
    if (prev.row < 0 || prev.col < 0) break;
    if (!board[prev.row][prev.col]) break;
    leftStart = prev;
  }

  const fixedLeft = [];
  let cursor = { ...leftStart };
  while (cursor.row !== anchor.row || cursor.col !== anchor.col) {
    fixedLeft.push(board[cursor.row][cursor.col].letter);
    cursor = { row: cursor.row + dr, col: cursor.col + dc };
  }

  if (fixedLeft.length > 0) {
    extendRight(board, rack, anchor, direction, fixedLeft.join(''), [], anchor, isFirstMove, out);
  } else {
    let maxLeft = 0;
    cursor = { row: anchor.row - dr, col: anchor.col - dc };
    while (
      cursor.row >= 0 && cursor.col >= 0 &&
      !board[cursor.row][cursor.col] &&
      maxLeft < rack.length
    ) {
      const beyond = { row: cursor.row - dr, col: cursor.col - dc };
      const beyondHasTile =
        beyond.row >= 0 && beyond.col >= 0 && board[beyond.row][beyond.col];
      if (beyondHasTile) break;
      maxLeft++;
      cursor = { row: cursor.row - dr, col: cursor.col - dc };
    }

    for (let leftLen = 0; leftLen <= maxLeft; leftLen++) {
      const startSquare = {
        row: anchor.row - dr * leftLen,
        col: anchor.col - dc * leftLen,
      };
      tryLeftCombinations(
        board, rack, startSquare, anchor, direction,
        leftLen, '', [], isFirstMove, out
      );
    }
  }
}

function tryLeftCombinations(
  board, rack, startSquare, anchor, direction,
  leftLen, leftSoFar, placementsSoFar, isFirstMove, out
) {
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

  const tried = new Set();
  for (let i = 0; i < rack.length; i++) {
    const tile = rack[i];
    if (tried.has(tile)) continue;
    tried.add(tile);

    const isBlank = tile === '_';
    const letters = isBlank ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') : [tile];

    for (const letter of letters) {
      const cross = checkCrossWord(board, placeAt, letter, direction);
      if (!cross.valid) continue;

      const newRack = [...rack];
      newRack.splice(i, 1);
      const newPlacements = [
        ...placementsSoFar,
        { row: placeAt.row, col: placeAt.col, letter, blank: isBlank },
      ];
      tryLeftCombinations(
        board, newRack, startSquare, anchor, direction,
        leftLen, leftSoFar + letter, newPlacements, isFirstMove, out
      );
    }
  }
}

function extendRight(
  board, rack, cursor, direction,
  wordSoFar, placementsSoFar, anchor, isFirstMove, out
) {
  const dr = direction === HORIZONTAL ? 0 : 1;
  const dc = direction === HORIZONTAL ? 1 : 0;

  if (
    cursor.row >= BOARD_SIZE || cursor.col >= BOARD_SIZE ||
    cursor.row < 0 || cursor.col < 0
  ) {
    if (canRecord(placementsSoFar, anchor)) {
      tryRecord(wordSoFar, placementsSoFar, out);
    }
    return;
  }

  const cell = board[cursor.row][cursor.col];

  if (cell) {
    const newWord = wordSoFar + cell.letter;
    extendRight(
      board, rack,
      { row: cursor.row + dr, col: cursor.col + dc },
      direction, newWord, placementsSoFar, anchor, isFirstMove, out
    );
  } else {
    if (canRecord(placementsSoFar, anchor)) {
      tryRecord(wordSoFar, placementsSoFar, out);
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
        const newPlacements = [
          ...placementsSoFar,
          { row: cursor.row, col: cursor.col, letter, blank: isBlank },
        ];
        extendRight(
          board, newRack,
          { row: cursor.row + dr, col: cursor.col + dc },
          direction, wordSoFar + letter, newPlacements, anchor, isFirstMove, out
        );
      }
    }
  }
}

function canRecord(placements, anchor) {
  if (placements.length === 0) return false;
  return true;
}

function tryRecord(word, placements, out) {
  if (word.length < 2) return;
  if (placements.length === 0) return;
  if (!isValidWord(word)) return;
  out.push({ word, placements });
}

function checkCrossWord(board, square, letter, direction) {
  const perp = direction === HORIZONTAL ? VERTICAL : HORIZONTAL;
  const dr = perp === HORIZONTAL ? 0 : 1;
  const dc = perp === HORIZONTAL ? 1 : 0;

  let start = { ...square };
  while (true) {
    const prev = { row: start.row - dr, col: start.col - dc };
    if (prev.row < 0 || prev.col < 0 || prev.row >= BOARD_SIZE || prev.col >= BOARD_SIZE) break;
    if (!board[prev.row][prev.col]) break;
    start = prev;
  }

  let cross = '';
  let cursor = { ...start };
  while (
    cursor.row >= 0 && cursor.col >= 0 &&
    cursor.row < BOARD_SIZE && cursor.col < BOARD_SIZE
  ) {
    if (cursor.row === square.row && cursor.col === square.col) {
      cross += letter;
    } else if (board[cursor.row][cursor.col]) {
      cross += board[cursor.row][cursor.col].letter;
    } else {
      break;
    }
    cursor = { row: cursor.row + dr, col: cursor.col + dc };
  }

  if (cross.length === 1) return { valid: true };
  if (!isValidWord(cross)) return { valid: false };
  return { valid: true };
}