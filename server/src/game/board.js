import { BOARD_SIZE } from '../events.js';

export function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(null)
  );
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function inBounds(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}