// Pure functions only. No side effects, no I/O.
// Phase 1 exposes just enough surface for the socket layer to call.
// Phases 2+ will add: tile bag, board validation, word scoring, dictionary lookup.

export function createInitialGameState() {
  return {
    status: 'waiting',
    board: Array.from({ length: 15 }, () => Array(15).fill(null)),
    tileBag: null, // populated on start in a later phase
    scores: {},
  };
}

export function advanceTurn(turnOrder, currentTurnPlayerId) {
  if (!turnOrder || turnOrder.length === 0) return null;
  const idx = turnOrder.indexOf(currentTurnPlayerId);
  if (idx === -1) return turnOrder[0];
  return turnOrder[(idx + 1) % turnOrder.length];
}

export function isPlayersTurn(room, playerId) {
  return room.currentTurnPlayerId === playerId;
}