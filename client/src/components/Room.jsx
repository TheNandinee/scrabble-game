import { useMemo, useState } from 'react';

export default function Room({ room, mySocketId, onLeave, onStart }) {
  const [copied, setCopied] = useState(false);

  const shareUrl = useMemo(() => {
    const base = window.location.origin + window.location.pathname;
    return `${base}?room=${room.id}`;
  }, [room.id]);

  const isHost = room.hostId === mySocketId;
  const isMyTurn = room.currentTurnPlayerId === mySocketId;
  const gameInProgress = room.status === 'in_progress';

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="room">
      <div className="card">
        <div className="room-header">
          <div>
            <div className="label">Room code</div>
            <div className="code" onClick={copyCode} title="Click to copy">
              {room.id}
            </div>
          </div>
          <div className="room-actions">
            <button className="btn small" onClick={copyLink}>
              {copied ? 'Copied!' : 'Copy invite link'}
            </button>
            <button className="btn small danger" onClick={onLeave}>
              Leave
            </button>
          </div>
        </div>

        <div className="status-line">
          Status: <strong>{room.status}</strong>
          {gameInProgress && (
            <span className={isMyTurn ? 'turn you' : 'turn'}>
              {isMyTurn
                ? "It's your turn"
                : `Waiting for ${
                    room.players.find((p) => p.id === room.currentTurnPlayerId)?.name || '...'
                  }`}
            </span>
          )}
        </div>

        <h3>Players ({room.players.length})</h3>
        <ul className="players">
          {room.players.map((p, i) => (
            <li key={p.id} className={p.id === mySocketId ? 'me' : ''}>
              <span className="pnum">{i + 1}.</span>
              <span className="pname">{p.name}</span>
              {p.id === room.hostId && <span className="tag">host</span>}
              {p.id === mySocketId && <span className="tag you">you</span>}
              {gameInProgress && p.id === room.currentTurnPlayerId && (
                <span className="tag turn-tag">turn</span>
              )}
            </li>
          ))}
        </ul>

        {!gameInProgress && (
          <div className="row">
            {isHost ? (
              <button
                className="btn primary"
                disabled={room.players.length < 2}
                onClick={onStart}
              >
                {room.players.length < 2
                  ? 'Waiting for more players...'
                  : 'Start Game'}
              </button>
            ) : (
              <div className="muted">Waiting for the host to start the game...</div>
            )}
          </div>
        )}

        {gameInProgress && (
          <div className="board-placeholder">
            <p>
              🎲 Game in progress. The Scrabble board and tile mechanics land in
              Phase 2.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}