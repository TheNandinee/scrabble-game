import { LETTER_VALUES, PREMIUM_SQUARES, BINGO_BONUS } from './constants.js';
import { inBounds } from './board.js';
import { RACK_SIZE } from '../events.js';

export function scoreMove(board, placements) {
  if (!placements.length) return { total: 0, words: [] };

  const placedSet = new Set(placements.map((p) => `${p.row},${p.col}`));
  const words = extractFormedWords(board, placements);

  let total = 0;
  const wordDetails = [];

  for (const word of words) {
    let wordScore = 0;
    let wordMultiplier = 1;

    for (const { row, col } of word.cells) {
      const cell = board[row][col];
      if (!cell) continue;
      const base = cell.blank ? 0 : (LETTER_VALUES[cell.letter] || 0);
      let letterScore = base;

      if (placedSet.has(`${row},${col}`)) {
        const prem = PREMIUM_SQUARES[row][col];
        if (prem === 'DL') letterScore = base * 2;
        else if (prem === 'TL') letterScore = base * 3;
        else if (prem === 'DW') wordMultiplier *= 2;
        else if (prem === 'TW') wordMultiplier *= 3;
      }
      wordScore += letterScore;
    }

    wordScore *= wordMultiplier;
    total += wordScore;
    wordDetails.push({ word: word.text, score: wordScore });
  }

  if (placements.length === RACK_SIZE) {
    total += BINGO_BONUS;
    wordDetails.push({ word: 'BINGO', score: BINGO_BONUS });
  }

  return { total, words: wordDetails };
}

export function extractFormedWords(board, placements) {
  if (placements.length === 0) return [];

  const placedSet = new Set(placements.map((p) => `${p.row},${p.col}`));
  const rows = placements.map((p) => p.row);
  const cols = placements.map((p) => p.col);
  const allSameRow = rows.every((r) => r === rows[0]);
  const allSameCol = cols.every((c) => c === cols[0]);

  const words = [];
  const seen = new Set();

  const addWord = (cells) => {
    if (cells.length < 2) return;
    if (!cells.some(({ row, col }) => placedSet.has(`${row},${col}`))) return;
    const key = cells.map((c) => `${c.row},${c.col}`).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const text = cells.map(({ row, col }) => board[row][col].letter).join('');
    words.push({ text, cells });
  };

  if (allSameRow) {
    addWord(expandWord(board, placements[0].row, placements[0].col, 'H'));
  } else if (allSameCol) {
    addWord(expandWord(board, placements[0].row, placements[0].col, 'V'));
  } else {
    addWord(expandWord(board, placements[0].row, placements[0].col, 'H'));
    addWord(expandWord(board, placements[0].row, placements[0].col, 'V'));
  }

  const crossDir = allSameRow ? 'V' : 'H';
  for (const p of placements) {
    addWord(expandWord(board, p.row, p.col, crossDir));
  }

  return words;
}

function expandWord(board, row, col, dir) {
  const [dr, dc] = dir === 'H' ? [0, 1] : [1, 0];
  let r = row, c = col;
  while (inBounds(r - dr, c - dc) && board[r - dr][c - dc]) {
    r -= dr; c -= dc;
  }
  const cells = [];
  while (inBounds(r, c) && board[r][c]) {
    cells.push({ row: r, col: c });
    r += dr; c += dc;
  }
  return cells;
}