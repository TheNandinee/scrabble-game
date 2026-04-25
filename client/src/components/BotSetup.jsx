import { useEffect, useState } from 'react';
import { loadPrefs, savePrefs } from '../localPrefs.js';

export default function BotSetup({ open, onClose, onStart, defaultName }) {
  const [name, setName] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [numBots, setNumBots] = useState(1);

  useEffect(() => {
    if (!open) return;
    const prefs = loadPrefs();
    setName(defaultName || prefs.lastName || '');
  }, [open, defaultName]);

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault?.();
    const n = name.trim();
    if (!n) return;
    savePrefs({ lastName: n });
    onStart({ name: n, difficulty, numBots });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>🤖 Play vs Computer</h3>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              Practice against AI opponents
            </p>
          </div>
          <button className="btn small ghost" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={submit}>
          {!defaultName && (
            <label className="field">
              <span>Your name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                placeholder="e.g. Alex"
                autoFocus
                required
              />
            </label>
          )}

          <label className="field">
            <span>Difficulty</span>
            <div className="size-toggle">
              <button
                type="button"
                className={`btn ${difficulty === 'easy' ? 'primary' : ''}`}
                onClick={() => setDifficulty('easy')}
              >
                😌 Easy
              </button>
              <button
                type="button"
                className={`btn ${difficulty === 'medium' ? 'primary' : ''}`}
                onClick={() => setDifficulty('medium')}
              >
                🎯 Medium
              </button>
              <button
                type="button"
                className={`btn ${difficulty === 'hard' ? 'primary' : ''}`}
                onClick={() => setDifficulty('hard')}
              >
                🦾 Hard
              </button>
            </div>
          </label>

          <label className="field">
            <span>Number of bots</span>
            <div className="size-toggle">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`btn ${numBots === n ? 'primary' : ''}`}
                  onClick={() => setNumBots(n)}
                >
                  {n} bot{n > 1 ? 's' : ''}
                </button>
              ))}
            </div>
          </label>

          <div className="info-banner" style={{ marginTop: 12 }}>
            <span style={{ fontSize: 13 }}>
              {difficulty === 'easy' && '😌 Easy bots play sub-optimal moves and sometimes pass.'}
              {difficulty === 'medium' && '🎯 Medium bots play decent moves — fair challenge.'}
              {difficulty === 'hard' && '🦾 Hard bots usually play the best legal move.'}
            </span>
          </div>

          <button className="btn primary" type="submit" style={{ width: '100%', marginTop: 16 }}>
            Start Game
          </button>
        </form>
      </div>
    </div>
  );
}