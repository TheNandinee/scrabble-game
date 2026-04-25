import { createEmptyBoard, cloneBoard } from './board.js';
import { createTileBag, drawTiles, returnTiles } from './tileBag.js';
import { validatePlacement } from './moveValidator.js';
import { scoreMove } from './scoring.js';
import { validateWords } from './dictionary.js';
import { RACK_SIZE, MAX_CONSECUTIVE_PASSES } from '../events.js';
import { LETTER_VALUES } from './constants.js';

export function initializeGame(seatIds) {
  const bag = createTileBag();
  const racks = {};
  const scores = {};
  for (const seatId of seatIds) {
    const { drawn } = drawTiles(bag, RACK_SIZE);
    racks[seatId] = drawn;
    scores[seatId] = 0;
  }
  return {
    status: 'in_progress',
    board: createEmptyBoard(),
    bag,
    racks,
    scores,
    turnNumber: 1,
    consecutivePasses: 0,
    moveHistory: [],
    isFirstMove: true,
  };
}

export function advanceTurn(turnOrder, currentSeatId) {
  if (!turnOrder || turnOrder.length === 0) return null;
  const idx = turnOrder.indexOf(currentSeatId);
  if (idx === -1) return turnOrder[0];
  return turnOrder[(idx + 1) % turnOrder.length];
}

export function applyMove(room, seatId, placements) {
  const game = room.gameState;
  if (game.status !== 'in_progress') return { ok: false, error: 'Game not in progress' };
  if (room.currentTurnSeatId !== seatId) return { ok: false, error: 'Not your turn' };

  const rack = game.racks[seatId] || [];
  const placement = validatePlacement(game.board, placements, rack, game.isFirstMove);
  if (!placement.ok) return { ok: false, error: placement.error };

  const newBoard = cloneBoard(game.board);
  for (const p of placements) {
    newBoard[p.row][p.col] = {
      letter: String(p.letter).toUpperCase(),
      seatId,
      blank: !!p.blank,
      placedOnTurn: game.turnNumber,
    };
  }

  const { total, words } = scoreMove(newBoard, placements);

  const wordCheck = validateWords(words);
  if (!wordCheck.ok) {
    return {
      ok: false,
      error: `Invalid word(s): ${wordCheck.invalid.join(', ')}`,
      invalidWords: wordCheck.invalid,
    };
  }

  const newRack = rack.slice();
  for (const p of placements) {
    const need = p.blank ? '_' : String(p.letter).toUpperCase();
    const idx = newRack.indexOf(need);
    if (idx !== -1) newRack.splice(idx, 1);
  }

  const newBag = game.bag.slice();
  const { drawn } = drawTiles(newBag, RACK_SIZE - newRack.length);
  const refilledRack = newRack.concat(drawn);

  const newRacks = { ...game.racks, [seatId]: refilledRack };
  const newScores = { ...game.scores, [seatId]: (game.scores[seatId] || 0) + total };

  const nextSeatId = advanceTurn(room.turnOrder, seatId);

  let status = 'in_progress';
  let endReason = null;
  if (refilledRack.length === 0 && newBag.length === 0) {
    status = 'finished';
    endReason = 'rack_empty';
  }

  const newGameState = {
    ...game,
    status,
    board: newBoard,
    bag: newBag,
    racks: newRacks,
    scores: newScores,
    turnNumber: game.turnNumber + 1,
    consecutivePasses: 0,
    isFirstMove: false,
    moveHistory: game.moveHistory.concat([
      { type: 'move', seatId, placements, score: total, words, turn: game.turnNumber, at: Date.now() },
    ]),
  };

  if (status === 'finished') {
    newGameState.scores = finalizeScoresOnRackEmpty(newGameState.racks, newGameState.scores, seatId);
  }

  return { ok: true, newGameState, nextSeatId, score: total, words, endReason };
}

export function passTurn(room, seatId, { auto = false } = {}) {
  const game = room.gameState;
  if (game.status !== 'in_progress') return { ok: false, error: 'Game not in progress' };
  if (room.currentTurnSeatId !== seatId) return { ok: false, error: 'Not your turn' };

  const newConsecutive = game.consecutivePasses + 1;
  const nextSeatId = advanceTurn(room.turnOrder, seatId);

  let status = 'in_progress';
  let endReason = null;
  if (newConsecutive >= MAX_CONSECUTIVE_PASSES) {
    status = 'finished';
    endReason = 'too_many_passes';
  }

  const newGameState = {
    ...game,
    status,
    turnNumber: game.turnNumber + 1,
    consecutivePasses: newConsecutive,
    moveHistory: game.moveHistory.concat([
      { type: auto ? 'timeout' : 'pass', seatId, turn: game.turnNumber, at: Date.now() },
    ]),
  };

  if (status === 'finished') {
    newGameState.scores = finalizeScoresOnAllPass(newGameState.racks, newGameState.scores);
  }

  return { ok: true, newGameState, nextSeatId, endReason };
}

export function swapTiles(room, seatId, tilesToSwap) {
  const game = room.gameState;
  if (game.status !== 'in_progress') return { ok: false, error: 'Game not in progress' };
  if (room.currentTurnSeatId !== seatId) return { ok: false, error: 'Not your turn' };
  if (game.bag.length < 7) return { ok: false, error: 'Not enough tiles in bag to swap (need 7+)' };
  if (!Array.isArray(tilesToSwap) || tilesToSwap.length === 0) {
    return { ok: false, error: 'Select tiles to swap' };
  }

  const rack = game.racks[seatId] || [];
  const rackCopy = rack.slice();
  for (const t of tilesToSwap) {
    const idx = rackCopy.indexOf(String(t).toUpperCase());
    if (idx === -1) return { ok: false, error: 'Swap includes tile not on your rack' };
    rackCopy.splice(idx, 1);
  }

  let newBag = game.bag.slice();
  const { drawn, bag: afterDraw } = drawTiles(newBag, tilesToSwap.length);
  newBag = returnTiles(afterDraw, tilesToSwap.map((t) => String(t).toUpperCase()));

  const newRack = rackCopy.concat(drawn);
  const newRacks = { ...game.racks, [seatId]: newRack };
  const nextSeatId = advanceTurn(room.turnOrder, seatId);

  const newGameState = {
    ...game,
    bag: newBag,
    racks: newRacks,
    turnNumber: game.turnNumber + 1,
    consecutivePasses: game.consecutivePasses + 1,
    moveHistory: game.moveHistory.concat([
      { type: 'swap', seatId, count: tilesToSwap.length, turn: game.turnNumber, at: Date.now() },
    ]),
  };

  return { ok: true, newGameState, nextSeatId };
}

function finalizeScoresOnRackEmpty(racks, scores, outSeatId) {
  const result = { ...scores };
  let bonus = 0;
  for (const [sid, rack] of Object.entries(racks)) {
    const leftover = rack.reduce((s, t) => s + (LETTER_VALUES[t] || 0), 0);
    if (sid !== outSeatId) {
      result[sid] = (result[sid] || 0) - leftover;
      bonus += leftover;
    }
  }
  result[outSeatId] = (result[outSeatId] || 0) + bonus;
  return result;
}

function finalizeScoresOnAllPass(racks, scores) {
  const result = { ...scores };
  for (const [sid, rack] of Object.entries(racks)) {
    const leftover = rack.reduce((s, t) => s + (LETTER_VALUES[t] || 0), 0);
    result[sid] = (result[sid] || 0) - leftover;
  }
  return result;
}