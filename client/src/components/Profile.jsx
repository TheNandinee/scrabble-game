import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Profile({ user, onClose, onUpdated, onSignout }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(user.displayName);
  const [error, setError] = useState('');

  useEffect(() => {
    api.history()
      .then((r) => setHistory(r.history || []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, []);

  const saveName = async () => {
    setError('');
    try {
      const { user: updated } = await api.updateProfile(newName.trim());
      onUpdated(updated);
      setEditingName(false);
    } catch (e) {
      setError(e?.message || 'Could not save');
    }
  };

  const resendVerify = async () => {
    try {
      await api.resendVerification();
      alert('Verification email sent.');
    } catch (e) {
      alert(e?.message || 'Could not resend');
    }
  };

  const winRate = user.gamesPlayed > 0
    ? Math.round((user.gamesWon / user.gamesPlayed) * 100)
    : 0;
  const avgScore = user.gamesPlayed > 0
    ? Math.round(user.totalScore / user.gamesPlayed)
    : 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Profile</h3>
          <button className="btn small" onClick={onClose}>✕</button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="profile-name-row">
          {editingName ? (
            <>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={30} />
              <button className="btn small primary" onClick={saveName}>Save</button>
              <button className="btn small" onClick={() => { setEditingName(false); setNewName(user.displayName); }}>Cancel</button>
            </>
          ) : (
            <>
              <div className="profile-name">{user.displayName}</div>
              <button className="btn small" onClick={() => setEditingName(true)}>Edit</button>
            </>
          )}
        </div>
        <div className="muted">{user.email}{!user.emailVerified && ' · unverified'}</div>
        {!user.emailVerified && (
          <button className="link-btn" onClick={resendVerify}>Resend verification email</button>
        )}

        <div className="stats-grid">
          <div className="stat"><div className="stat-num">{user.rating}</div><div className="stat-label">Rating</div></div>
          <div className="stat"><div className="stat-num">{user.gamesPlayed}</div><div className="stat-label">Games</div></div>
          <div className="stat"><div className="stat-num">{user.gamesWon}</div><div className="stat-label">Won</div></div>
          <div className="stat"><div className="stat-num">{winRate}%</div><div className="stat-label">Win rate</div></div>
          <div className="stat"><div className="stat-num">{user.highestScore}</div><div className="stat-label">Best</div></div>
          <div className="stat"><div className="stat-num">{avgScore}</div><div className="stat-label">Avg</div></div>
        </div>

        <h4>Recent games</h4>
        {loading ? (
          <div className="muted">Loading...</div>
        ) : history.length === 0 ? (
          <div className="muted">No finished games yet. Play one!</div>
        ) : (
          <ul className="history-list">
            {history.map((g) => (
              <li key={g.roomId} className={g.iWon ? 'h-move' : 'h-pass'}>
                <span className="h-turn">{g.iWon ? '🏆' : '·'}</span>
                <span className="h-who">vs {g.opponents.map((o) => `${o.name} (${o.score})`).join(', ')}</span>
                <span className="h-score">{g.myScore}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-footer">
          <button className="btn danger" onClick={onSignout}>Sign out</button>
        </div>
      </div>
    </div>
  );
}