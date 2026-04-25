import { useState } from 'react';
import TurnTimer from './TurnTimer.jsx';

export default function GameControls({
  isMyTurn, pendingCount, onSubmit, onRecall, onUndo, onPass, onSwap,
  rack, bagCount, turnExpiresAt, isSpectator,
}) {
  const [swapMode, setSwapMode] = useState(false);
  const [swapSelection, setSwapSelection] = useState(new Set());

  const safeRack = Array.isArray(rack) ? rack : [];

  const toggleSwapTile = (idx) => {
    setSwapSelection((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const confirmSwap = async () => {
    const tiles = Array.from(swapSelection).map((i) => safeRack[i]).filter(Boolean);
    if (tiles.length === 0) return;
    const res = await onSwap(tiles);
    if (res?.ok) {
      setSwapMode(false);
      setSwapSelection(new Set());
    }
  };

  if (isSpectator) {
    return (
      <div className="controls">
        <span className="muted">👁 Spectating</span>
        <TurnTimer expiresAt={turnExpiresAt} />
      </div>
    );
  }

  if (!isMyTurn) {
    return (
      <div className="controls">
        <span className="muted">Waiting for other player...</span>
        <TurnTimer expiresAt={turnExpiresAt} />
      </div>
    );
  }

  if (swapMode) {
    return (
      <div className="controls swap-mode">
        <div className="muted">Pick tiles to swap (bag has {bagCount}):</div>
        <div className="swap-rack">
          {safeRack.map((letter, idx) => (
            <button
              key={idx}
              className={`rack-tile ${swapSelection.has(idx) ? 'selected' : ''}`}
              onClick={() => toggleSwapTile(idx)}
            >
              <span className="letter">{letter === '_' ? '★' : letter}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn primary" disabled={swapSelection.size === 0} onClick={confirmSwap}>
            Confirm Swap
          </button>
          <button
            className="btn"
            onClick={() => { setSwapMode(false); setSwapSelection(new Set()); }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="controls">
      <TurnTimer expiresAt={turnExpiresAt} />
      <button className="btn primary" disabled={pendingCount === 0} onClick={onSubmit}>
        Submit {pendingCount > 0 && `(${pendingCount})`}
      </button>
      <button className="btn" disabled={pendingCount === 0} onClick={onUndo} title="Undo last placement">
        Undo
      </button>
      <button className="btn" disabled={pendingCount === 0} onClick={onRecall}>
        Recall All
      </button>
      <button
        className="btn"
        disabled={bagCount < 7}
        onClick={() => setSwapMode(true)}
        title={bagCount < 7 ? 'Need 7+ tiles in bag to swap' : 'Swap tiles'}
      >
        Swap
      </button>
      <button className="btn" onClick={onPass}>Pass</button>
    </div>
  );
}