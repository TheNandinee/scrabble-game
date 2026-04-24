import { useCallback, useEffect, useMemo, useState } from 'react';
import Board from './Board.jsx';
import Rack from './Rack.jsx';
import Scoreboard from './Scoreboard.jsx';
import GameControls from './GameControls.jsx';

export default function Room({
  room, rack, mySocketId,
  onLeave, onStart, onSubmitMove, onPass, onSwap,
}) {
  const [pendingPlacements, setPendingPlacements] = useState([]); // [{row, col, letter, rackIndex, blank}]
  const [selectedRackIndex, setSelectedRackIndex] = useState(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = useMemo(() => {
    const base = window.location.origin + window.location.pathname;
    return `${base}?room=${room.id}`;
  }, [room.id]);

  const isHost = room.hostId === mySocketId;
  const isMyTurn = room.currentTurnPlayerId === mySocketId;
  const gameInProgress = room.status === 'in_progress';
  const gameFinished = room.status === 'finished';

  // Clear pending placements when turn changes (e.g. move confirmed, or turn passed to us)
  useEffect(() => {
    setPendingPlacements([]);
    setSelectedRackIndex(null);
  }, [room.currentTurnPlayerId, room.turnNumber]);

  // Tile available on the rack (excluding any already pending)
  const availableRack = useMemo(() => {
    const usedIndexes = new Set(pendingPlacements.map((p) => p.rackIndex));
    return rack.map((letter, idx) => ({
      letter, idx, used: usedIndexes.has(idx),
    }));
  }, [rack, pendingPlacements]);

  const handleCellClick = useCallback((row, col) => {
    if (!isMyTurn || !gameInProgress) return;

    // Tile already on the real board (committed): ignore
    if (room.board && room.board[row][col]) return;

    // Tile we placed this turn: remove it
    const existing = pendingPlacements.find((p) => p.row === row && p.col === col);
    if (existing) {
      setPendingPlacements((prev) => prev.filter((p) => !(p.row === row && p.col === col)));
      return;
    }

    // Place selected rack tile here
    if (selectedRackIndex === null) return;
    const tile = rack[selectedRackIndex];
    if (tile === undefined) return;

    let letter = tile;
    let blank = false;
    if (tile === '_') {
      const choice = window.prompt('Enter a letter for the blank tile (A-Z):', 'A');
      if (!choice) return;
      const l = choice.trim().toUpperCase();
      if (!/^[A-Z]$/.test(l)) {
        alert('Must be a single letter A-Z.');
        return;
      }
      letter = l;
      blank = true;
    }

    setPendingPlacements((prev) => [
      ...prev,
      { row, col, letter, rackIndex: selectedRackIndex, blank },
    ]);
    setSelectedRackIndex(null);
  }, [isMyTurn, gameInProgress, pendingPlacements, selectedRackIndex, rack, room.board]);

  const handleRecall = () => {
    setPendingPlacements([]);
    setSelectedRackIndex(null);
  };

  const handleShuffle = () => {
    // visual-only shuffle; server owns canonical rack order
    setPendingPlacements([]);
    setSelectedRackIndex(null);
    // we emit nothing — rack is what the server sent; for a persistent shuffle we'd need a server event.
    // Simplest approach: local rack reorder via parent state isn't stored, so just leave as is.
    // We'll instead shuffle by forcing App.jsx to track local order. For Phase 2 keep it simple.
    alert('Shuffle is visual-only in Phase 2 — server holds canonical rack order.');
  };

  const handleSubmit = async () => {
    if (pendingPlacements.length === 0) return;
    const payload = pendingPlacements.map((p) => ({
      row: p.row, col: p.col, letter: p.letter, blank: p.blank,
    }));
    const res = await onSubmitMove(payload);
    if (res?.ok) {
      setPendingPlacements([]);
      setSelectedRackIndex(null);
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  };

  // WAITING LOBBY VIEW
  if (!gameInProgress && !gameFinished) {
    return (
      <div className="room">
        <div className="card">
          <div className="room-header">
            <div>
              <div className="label">Room code</div>
              <div className="code" onClick={copyCode}>{room.id}</div>
            </div>
            <div className="room-actions">
              <button className="btn small" onClick={copyLink}>
                {copied ? 'Copied!' : 'Copy invite link'}
              </button>
              <button className="btn small danger" onClick={onLeave}>Leave</button>
            </div>
          </div>

          <h3>Players ({room.players.length})</h3>
          <ul className="players">
            {room.players.map((p, i) => (
              <li key={p.id} className={p.id === mySocketId ? 'me' : ''}>
                <span className="pnum">{i + 1}.</span>
                <span className="pname">{p.name}</span>
                {p.id === room.hostId && <span className="tag">host</span>}
                {p.id === mySocketId && <span className="tag you">you</span>}
              </li>
            ))}
          </ul>

          {isHost ? (
            <button
              className="btn primary"
              disabled={room.players.length < 2}
              onClick={onStart}
            >
              {room.players.length < 2 ? 'Waiting for more players...' : 'Start Game'}
            </button>
          ) : (
            <div className="muted">Waiting for the host to start the game...</div>
          )}
        </div>
      </div>
    );
  }

  // IN-GAME / FINISHED VIEW
  return (
    <div className="game-shell">
      <div className="game-top">
        <div className="game-top-left">
          <div className="room-pill">Room <strong>{room.id}</strong></div>
          <button className="btn small" onClick={copyLink}>
            {copied ? 'Copied!' : 'Invite'}
          </button>
          <button className="btn small danger" onClick={onLeave}>Leave</button>
        </div>
        <div className="game-top-right">
          <span className="bag-pill">Bag: {room.bagCount}</span>
          <span className="turn-pill">Turn {room.turnNumber}</span>
        </div>
      </div>

      <div className="game-main">
        <Board
          board={room.board}
          pendingPlacements={pendingPlacements}
          onCellClick={handleCellClick}
          isMyTurn={isMyTurn}
        />

        <div className="side-panel">
          <Scoreboard
            players={room.players}
            scores={room.scores}
            currentTurnPlayerId={room.currentTurnPlayerId}
            mySocketId={mySocketId}
            rackCounts={room.rackCounts}
          />

          {gameFinished && (
            <div className="game-over">
              <h3>Game Over</h3>
              <p>Final scores shown on the scoreboard.</p>
              <button className="btn primary" onClick={onLeave}>Back to Lobby</button>
            </div>
          )}
        </div>
      </div>

      {gameInProgress && (
        <div className="bottom-panel">
          <Rack
            tiles={availableRack}
            selectedIndex={selectedRackIndex}
            onSelect={(idx) => setSelectedRackIndex(idx)}
            enabled={isMyTurn}
          />
          <GameControls
            isMyTurn={isMyTurn}
            pendingCount={pendingPlacements.length}
            onSubmit={handleSubmit}
            onRecall={handleRecall}
            onPass={onPass}
            onSwap={onSwap}
            rack={rack}
            bagCount={room.bagCount}
          />
        </div>
      )}

      <div className="phase-note">
        <strong>Phase 2 note:</strong> placement, scoring, and premium squares are live. Dictionary word validation lands in Phase 3 — for now, any letters are accepted.
      </div>
    </div>
  );
}