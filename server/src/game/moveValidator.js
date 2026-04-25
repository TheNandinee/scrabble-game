import { inBounds } from './board.js';
import { CENTER } from './constants.js';

export function validatePlacement(board, placements, rack, isFirstMove) {
  if (!Array.isArray(placements) || placements.length === 0) {
    return { ok: false, error: 'No tiles placed' };
  }

  const seen = new Set();
  for (const p of placements) {
    if (!inBounds(p.row, p.col)) return { ok: false, error: 'Out of bounds' };
    if (board[p.row][p.col]) return { ok: false, error: 'Cell already occupied' };
    const key = `${p.row},${p.col}`;
    if (seen.has(key)) return { ok: false, error: 'Duplicate placement' };
    seen.add(key);
    if (typeof p.letter !== 'string' || p.letter.length !== 1) {
      return { ok: false, error: 'Invalid tile' };
    }
  }

  const rows = placements.map((p) => p.row);
  const cols = placements.map((p) => p.col);
  const sameRow = rows.every((r) => r === rows[0]);
  const sameCol = cols.every((c) => c === cols[0]);
  if (!sameRow && !sameCol) {
    return { ok: false, error: 'Tiles must be in the same row or column' };
  }

  if (sameRow) {
    const row = rows[0];
    const sorted = placements.slice().sort((a, b) => a.col - b.col);
    const minC = sorted[0].col;
    const maxC = sorted[sorted.length - 1].col;
    for (let c = minC; c <= maxC; c++) {
      const placedHere = placements.some((p) => p.col === c);
      if (!placedHere && !board[row][c]) {
        return { ok: false, error: 'Placed tiles must be contiguous' };
      }
    }
  } else {
    const col = cols[0];
    const sorted = placements.slice().sort((a, b) => a.row - b.row);
    const minR = sorted[0].row;
    const maxR = sorted[sorted.length - 1].row;
    for (let r = minR; r <= maxR; r++) {
      const placedHere = placements.some((p) => p.row === r);
      if (!placedHere && !board[r][col]) {
        return { ok: false, error: 'Placed tiles must be contiguous' };
      }
    }
  }

  if (isFirstMove) {
    const coversCenter = placements.some(
      (p) => p.row === CENTER.row && p.col === CENTER.col
    );
    if (!coversCenter) {
      return { ok: false, error: 'First move must cover the center square' };
    }
  } else {
    const touchesExisting = placements.some((p) =>
      [[-1,0],[1,0],[0,-1],[0,1]].some(([dr, dc]) => {
        const r = p.row + dr, c = p.col + dc;
        return inBounds(r, c) && board[r][c];
      })
    );
    if (!touchesExisting) {
      return { ok: false, error: 'Move must connect to an existing tile' };
    }
  }

  const rackCopy = rack.slice();
  for (const p of placements) {
    const need = p.blank ? '_' : String(p.letter).toUpperCase();
    const idx = rackCopy.indexOf(need);
    if (idx === -1) {
      return { ok: false, error: `Missing tile "${need}" on rack` };
    }
    rackCopy.splice(idx, 1);
  }

  return { ok: true };
}