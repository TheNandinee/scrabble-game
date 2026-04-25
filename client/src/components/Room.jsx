import { useCallback, useEffect, useMemo, useState } from 'react';
import Board from './Board.jsx';
import Rack from './Rack.jsx';
import Scoreboard from './Scoreboard.jsx';
import GameControls from './GameControls.jsx';
import MoveHistory from './MoveHistory.jsx';

export default function Room({
  room, rack, mySeatId, role,
  onLeave, onStart, onSubmitMove, onPass, onSwap,
  playSound,
}) {
  console.log('[Room debug]', { mySeatId, hostSeatId: room?.hostSeatId, isHost: room?.hostSeatId === mySeatId, roomKeys: Object.keys(room || {}), roomId: room?.id });
  const [pendingPlacements, setPendingPlacements] = useState([]);
  const [selectedRackIndex, setSelectedRackIndex] = useState(null);
  const [copied, setCopied] = useState(false);
  // local-only rack reordering for shuffle. Maps display position -> rack index.
  const [rackOrder, setRackOrder] = useState(null);

  const isSpectator = role === 'spectator';
  const hasRoom = room && typeof room === 'object' && typeof room.id === 'string';

  const shareUrl = useMemo(() => {
    if (!hasRoom) return '';
    const base = window.location.origin + window.location.pathname;
    return `${base}?room=${room.id}`;
  }, [hasRoom, room]);

  const players = Array.isArray(room?.players) ? room.players : [];
  const isHost = hasRoom && room.hostSeatId === mySeatId;
  const isMyTurn = !isSpectator && hasRoom && room.currentTurnSeatId === mySeatId;
  const gameInProgress = room?.status === 'in_progress';
  const gameFinished = room?.status === 'finished';

  // Reset pending tiles whenever turn changes (server commits or rotates)
  useEffect(() => {
    setPendingPlacements([]);
    setSelectedRackIndex(null);
  }, [room?.currentTurnSeatId, room?.turnNumber]);

  // Reset shuffle order when rack actually changes (after submit/swap)
  useEffect(() => {
    setRackOrder(null);
  }, [rack]);

  // displayRack uses rackOrder if set, otherwise natural order
  const displayRack = useMemo(() => {
    const used = new Set(pendingPlacements.map((p) => p.rackIndex));
    const base = (rack || []).map((letter, idx) => ({ letter, idx, used: used.has(idx) }));
    if (!rackOrder || rackOrder.length !== base.length) return base;
    // Map rackOrder[i] -> base item at that idx
    return rackOrder.map((origIdx) => base.find((t) => t.idx === origIdx)).filter(Boolean);
  }, [rack, pendingPlacements, rackOrder]);

  const placeTileAt = useCallback((row, col, rackIdx) => {
    if (!isMyTurn || !gameInProgress) return;
    if (rack?.[rackIdx] === undefined) return;
    if (room?.board && room.board[row] && room.board[row][col]) return;
    if (pendingPlacements.some((p) => p.row === row && p.col === col)) return;
    if (pendingPlacements.some((p) => p.rackIndex === rackIdx)) return;

    let letter = rack[rackIdx], blank = false;
    if (letter === '_') {
      const choice = window.prompt('Enter a letter for the blank tile (A-Z):', 'A');
      if (!choice) return;
      const l = choice.trim().toUpperCase();
      if (!/^[A-Z]$/.test(l)) { alert('Must be a single letter A-Z.'); return; }
      letter = l; blank = true;
    }

    setPendingPlacements((prev) => [...prev, { row, col, letter, rackIndex: rackIdx, blank }]);
    setSelectedRackIndex(null);
    playSound?.('place');
  }, [isMyTurn, gameInProgress, pendingPlacements, rack, room, playSound]);

  const handleCellClick = useCallback((row, col) => {
    if (!isMyTurn || !gameInProgress) return;
    if (room?.board && room.board[row] && room.board[row][col]) return;

    const existing = pendingPlacements.find((p) => p.row === row && p.col === col);
    if (existing) {
      setPendingPlacements((prev) => prev.filter((p) => !(p.row === row && p.col === col)));
      return;
    }

    if (selectedRackIndex === null) return;
    placeTileAt(row, col, selectedRackIndex);
  }, [isMyTurn, gameInProgress, pendingPlacements, selectedRackIndex, room, placeTileAt]);

  const handleCellDrop = useCallback((row, col, rackIdx) => {
    placeTileAt(row, col, rackIdx);
  }, [placeTileAt]);

  const handleRecall = () => {
    setPendingPlacements([]);
    setSelectedRackIndex(null);
  };

  const handleUndo = () => {
    setPendingPlacements((prev) => prev.slice(0, -1));
    setSelectedRackIndex(null);
  };

  const handleShuffle = () => {
    if (!Array.isArray(rack) || rack.length === 0) return;
    const indices = rack.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    setRackOrder(indices);
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
    if (!hasRoom) return;
    try { await navigator.clipboard.writeText(room.id); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
  };
  const copyLink = async () => {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
  };

  if (!hasRoom) {
    return (
      <div className="room">
        <div className="card"><h3>Loading room...</h3></div>
      </div>
    );
  }

  // ---- Lobby ----
  if (!gameInProgress && !gameFinished) {
    return (
      <div className="room">
        <div className="card">
          <div className="room-header">
            <div>
              <div className="label">Room code {isSpectator && <span className="tag">spectator</span>}</div>
              <div className="code" onClick={copyCode}>{room.id}</div>
            </div>
            <div className="room-actions">
              <button className="btn small" onClick={copyLink}>
                {copied ? 'Copied!' : 'Copy invite link'}
              </button>
              <button className="btn small danger" onClick={onLeave}>Leave</button>
            </div>
          </div>

          <h3>Players ({players.length})</h3>
          <ul className="players">
            {players.map((p, i) => (
              <li key={p.seatId || i} className={p.seatId === mySeatId ? 'me' : ''}>
                <span className="pnum">{i + 1}.</span>
                <span className="pname">{p.name}</span>
                {p.seatId === room.hostSeatId && <span className="tag">host</span>}
                {p.seatId === mySeatId && <span className="tag you">you</span>}
                {p.connected === false && <span className="tag offline-tag">offline</span>}
              </li>
            ))}
          </ul>

          {(room.spectatorCount || 0) > 0 && (
            <div className="muted">👁 {room.spectatorCount} spectator{room.spectatorCount > 1 ? 's' : ''} watching</div>
          )}

          {isSpectator ? (
            <div className="muted" style={{ marginTop: 12 }}>
              You're spectating. The host will start the game when ready.
            </div>
          ) : isHost ? (
            <button
              className="btn primary"
              disabled={players.length < 2}
              onClick={onStart}
              style={{ marginTop: 12 }}
            >
              {players.length < 2 ? 'Waiting for more players...' : 'Start Game'}
            </button>
          ) : (
            <div className="muted" style={{ marginTop: 12 }}>
              Waiting for the host to start the game...
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- Game ----
  return (
    <div className="game-shell">
      <div className="game-top">
        <div className="game-top-left">
          <div className="room-pill">Room <strong>{room.id}</strong></div>
          {isSpectator && <span className="tag spectator-tag">👁 spectating</span>}
          <button className="btn small" onClick={copyLink}>{copied ? 'Copied!' : 'Invite'}</button>
          <button className="btn small danger" onClick={onLeave}>Leave</button>
        </div>
        <div className="game-top-right">
          {(room.spectatorCount || 0) > 0 && (
            <span className="bag-pill">👁 {room.spectatorCount}</span>
          )}
          <span className="bag-pill">Bag: {room.bagCount ?? 0}</span>
          <span className="turn-pill">Turn {room.turnNumber ?? 0}</span>
        </div>
      </div>

      <div className="game-main">
        <Board
          board={room.board}
          pendingPlacements={pendingPlacements}
          onCellClick={handleCellClick}
          onCellDrop={handleCellDrop}
          isMyTurn={isMyTurn}
        />

        <div className="side-panel">
          <Scoreboard
            players={players}
            scores={room.scores || {}}
            currentTurnSeatId={room.currentTurnSeatId}
            mySeatId={mySeatId}
            rackCounts={room.rackCounts || {}}
          />
          <MoveHistory history={room.moveHistory || []} players={players} />

          {gameFinished && (
            <div className="game-over">
              <h3>Game Over</h3>
              <p>Final scores shown above.</p>
              <button className="btn primary" onClick={onLeave}>Back to Lobby</button>
            </div>
          )}
        </div>
      </div>

      {gameInProgress && !isSpectator && (
        <div className="bottom-panel">
          <Rack
            tiles={displayRack}
            selectedIndex={selectedRackIndex}
            onSelect={(idx) => setSelectedRackIndex(idx)}
            onShuffle={handleShuffle}
            enabled={isMyTurn}
          />
          <GameControls
            isMyTurn={isMyTurn}
            pendingCount={pendingPlacements.length}
            onSubmit={handleSubmit}
            onRecall={handleRecall}
            onUndo={handleUndo}
            onPass={onPass}
            onSwap={onSwap}
            rack={rack || []}
            bagCount={room.bagCount ?? 0}
            turnExpiresAt={room.turnExpiresAt}
            isSpectator={isSpectator}
          />
        </div>
      )}

      {gameInProgress && isSpectator && (
        <div className="bottom-panel">
          <GameControls
            isMyTurn={false}
            pendingCount={0}
            isSpectator={true}
            turnExpiresAt={room.turnExpiresAt}
          />
        </div>
      )}
    </div>
  );
}