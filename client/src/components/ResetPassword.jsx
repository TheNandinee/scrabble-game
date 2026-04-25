import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function ResetPassword({ onDone, onAuthed }) {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token') || '');
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');
    try {
      const { user } = await api.resetPassword(token, password);
      onAuthed(user);
      setDone(true);
    } catch (err) {
      setError(err?.message || 'Could not reset');
    }
  };

  if (done) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: '60px auto' }}>
        <h3>Password updated ✅</h3>
        <button className="btn primary" onClick={onDone}>Continue</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 480, margin: '60px auto' }}>
      <h3>Reset your password</h3>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={submit}>
        <label className="field">
          <span>New password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </label>
        <label className="field">
          <span>Confirm password</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
        </label>
        <button className="btn primary" type="submit">Update password</button>
        <button className="btn" type="button" onClick={onDone} style={{ marginLeft: 8 }}>Cancel</button>
      </form>
    </div>
  );
}