import { useEffect, useState } from 'react';
import { loadPrefs, savePrefs } from '../localPrefs.js';

export default function Home({ onCreate, onJoin, onSpectate, user, onSignInClick }) {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [mode, setMode] = useState('player');

  useEffect(() => {
    if (user) {
      setName(user.displayName);
    } else {
      const prefs = loadPrefs();
      if (prefs.lastName) setName(prefs.lastName);
    }
    const params = new URLSearchParams(window.location.search);
    const r = params.get('room');
    if (r) setRoomId(r.toUpperCase());
  }, [user]);

  const persistName = (n) => {
    setName(n);
    if (!user) savePrefs({ lastName: n.trim() });
  };

  const canCreate = name.trim().length > 0;
  const canJoin = mode === 'player'
    ? name.trim().length > 0 && roomId.trim().length > 0
    : roomId.trim().length > 0;

  return (
    <div className="home">
      <div className="card">
        <h2>Join or Create a Game</h2>

        {!user && (
          <div className="info-banner" style={{ marginBottom: 16 }}>
            Playing anonymously. <button className="link-btn" onClick={onSignInClick}>Sign in</button> to save your stats and game history.
          </div>
        )}

        <div className="mode-toggle">
          <button
            className={`btn small ${mode === 'player' ? 'primary' : ''}`}
            onClick={() => setMode('player')}
          >
            Play
          </button>
          <button
            className={`btn small ${mode === 'spectator' ? 'primary' : ''}`}
            onClick={() => setMode('spectator')}
          >
            Spectate
          </button>
        </div>

        <label className="field">
          <span>{mode === 'spectator' ? 'Display name (optional)' : 'Your name'}</span>
          <input
            type="text"
            maxLength={20}
            value={name}
            onChange={(e) => persistName(e.target.value)}
            placeholder={mode === 'spectator' ? 'e.g. Watcher' : 'e.g. Alex'}
            disabled={!!user}
          />
        </label>

        {mode === 'player' && (
          <>
            <div className="row">
              <button
                className="btn primary"
                disabled={!canCreate}
                onClick={() => onCreate(name.trim())}
              >
                Create Room
              </button>
            </div>

            <div className="divider"><span>or</span></div>
          </>
        )}

        <label className="field">
          <span>Room code</span>
          <input
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            placeholder="e.g. A3F7KZ"
            maxLength={8}
          />
        </label>

        <div className="row">
          <button
            className="btn"
            disabled={!canJoin}
            onClick={() => {
              if (mode === 'spectator') onSpectate(roomId.trim().toUpperCase(), name.trim() || 'Spectator');
              else onJoin(roomId.trim().toUpperCase(), name.trim());
            }}
          >
            {mode === 'spectator' ? 'Spectate Room' : 'Join Room'}
          </button>
        </div>
      </div>
    </div>
  );
}