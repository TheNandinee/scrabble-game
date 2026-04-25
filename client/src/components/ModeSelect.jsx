import { useState } from 'react';

export default function ModeSelect({ onPickFriend, onPickQuickMatch, onPickComputer, onSpectate, onSignInClick, user }) {
  const [showJoinByCode, setShowJoinByCode] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [spectatorMode, setSpectatorMode] = useState(false);

  if (showJoinByCode) {
    return (
      <div className="mode-select">
        <button className="link-btn" onClick={() => setShowJoinByCode(false)}>← Back</button>
        <div className="card" style={{ marginTop: 12 }}>
          <h2>{spectatorMode ? 'Spectate a room' : 'Join with room code'}</h2>
          <label className="field">
            <span>Room code</span>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="A3F7KZ"
              maxLength={8}
            />
          </label>
          <div className="row">
            <button
              className="btn primary"
              disabled={!roomCode.trim()}
              onClick={() => {
                if (spectatorMode) onSpectate(roomCode.trim().toUpperCase());
                else onPickFriend({ joinCode: roomCode.trim().toUpperCase() });
              }}
            >
              {spectatorMode ? 'Spectate' : 'Join'}
            </button>
            <button className="btn" onClick={() => setSpectatorMode(!spectatorMode)}>
              {spectatorMode ? 'Switch to play' : 'Spectate instead'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mode-select">
      <h2 style={{ textAlign: 'center', marginBottom: 24 }}>How do you want to play?</h2>

      <div className="mode-grid">
        <button className="mode-card" onClick={() => onPickFriend({})}>
          <div className="mode-emoji">👥</div>
          <h3>Play with Friend</h3>
          <p>Create a room and share the link</p>
        </button>

        <button
          className={`mode-card ${!user ? 'locked' : ''}`}
          onClick={() => user ? onPickQuickMatch() : onSignInClick()}
        >
          <div className="mode-emoji">🎲</div>
          <h3>Quick Match</h3>
          <p>{user ? 'Find a random opponent' : 'Sign in required'}</p>
        </button>

        <button className="mode-card disabled" disabled>
          <div className="mode-emoji">🤖</div>
          <h3>Play vs Computer</h3>
          <p>Coming in Phase 8</p>
        </button>
      </div>

      <div className="mode-bottom">
        <button className="link-btn" onClick={() => setShowJoinByCode(true)}>
          Have a room code?
        </button>
      </div>

      {!user && (
        <div className="info-banner" style={{ marginTop: 16 }}>
          Playing anonymously — <button className="link-btn" onClick={onSignInClick}>sign in</button> to access matchmaking, friends, and stats.
        </div>
      )}
    </div>
  );
}