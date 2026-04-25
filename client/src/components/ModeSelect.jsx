import { useState } from 'react';

export default function ModeSelect({
  user, onPickFriend, onPickQuickMatch, onPickComputer, onSpectate, onSignInClick,
}) {
  const [view, setView] = useState('main'); // main | join_code | spectate_code
  const [roomCode, setRoomCode] = useState('');

  if (view === 'join_code' || view === 'spectate_code') {
    const isSpectate = view === 'spectate_code';
    return (
      <div className="mode-select">
        <button className="link-btn" onClick={() => { setView('main'); setRoomCode(''); }}>
          ← Back to menu
        </button>
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginBottom: 8 }}>
            {isSpectate ? '👀 Spectate a game' : '🔑 Join with code'}
          </h2>
          <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
            {isSpectate
              ? 'Watch an in-progress game without taking a seat.'
              : 'Enter the 6-character code your friend shared.'}
          </p>
          <label className="field">
            <span>Room code</span>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="A3F7KZ"
              maxLength={8}
              autoFocus
              style={{ fontFamily: 'var(--font-mono)', letterSpacing: 4, fontSize: 18 }}
            />
          </label>
          <button
            className="btn primary"
            disabled={!roomCode.trim()}
            onClick={() => {
              const code = roomCode.trim().toUpperCase();
              if (isSpectate) onSpectate(code);
              else onPickFriend({ joinCode: code });
            }}
            style={{ width: '100%' }}
          >
            {isSpectate ? 'Spectate' : 'Join Room'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mode-select">
      <div className="mode-select-hero">
        <h2>Welcome{user ? `, ${user.displayName}` : ''} 👋</h2>
        <p>How do you want to play?</p>
      </div>

      <div className="mode-grid">
        <button className="mode-card" onClick={() => onPickFriend({})}>
          <span className="mode-emoji">👥</span>
          <h3>Play with Friend</h3>
          <p>Create a private room and share the code</p>
        </button>

        <button
          className={`mode-card ${!user ? 'locked' : ''}`}
          onClick={() => user ? onPickQuickMatch() : onSignInClick()}
        >
          <span className="mode-emoji">⚡</span>
          <h3>Quick Match</h3>
          <p>{user ? 'Find a random opponent' : '🔒 Sign in to play'}</p>
        </button>

        <button className="mode-card" onClick={onPickComputer}>
          <span className="mode-emoji">🤖</span>
          <h3>vs Computer</h3>
          <p>Practice against an AI opponent</p>
        </button>
      </div>

      <div className="mode-bottom">
        <button className="link-btn" onClick={() => setView('join_code')}>
          Have a room code?
        </button>
        <span className="muted">·</span>
        <button className="link-btn" onClick={() => setView('spectate_code')}>
          Spectate a game
        </button>
      </div>

      {!user && (
        <div className="info-banner" style={{ marginTop: 24 }}>
          <span>
            Playing anonymously — <button className="link-btn" onClick={onSignInClick} style={{ display: 'inline' }}>sign in</button> to access matchmaking, friends, and stats.
          </span>
        </div>
      )}
    </div>
  );
}