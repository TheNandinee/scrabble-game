import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function AuthModal({ open, onClose, onAuthed, defaultMode = 'signin' }) {
  const [mode, setMode] = useState(defaultMode); // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(defaultMode);
    setError(''); setInfo('');
    api.googleStatus().then((r) => setGoogleEnabled(!!r.enabled)).catch(() => setGoogleEnabled(false));
  }, [open, defaultMode]);

  if (!open) return null;

  const submit = async (e) => {
    e?.preventDefault?.();
    setError(''); setInfo(''); setLoading(true);
    try {
      if (mode === 'signin') {
        const { user } = await api.signin(email.trim(), password);
        onAuthed(user); onClose();
      } else if (mode === 'signup') {
        const { user } = await api.signup(email.trim(), password, displayName.trim());
        onAuthed(user); onClose();
      } else if (mode === 'forgot') {
        await api.requestPasswordReset(email.trim());
        setInfo("If that email is registered, we've sent a reset link.");
      }
    } catch (err) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const startGoogle = () => {
    window.location.href = `${api.serverUrl}/auth/google`;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password'}
          </h3>
          <button className="btn small" onClick={onClose}>✕</button>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {info && <div className="info-banner">{info}</div>}

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <label className="field">
              <span>Display name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={30}
                required
              />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          {mode !== 'forgot' && (
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={8}
                required
              />
            </label>
          )}
          <button className="btn primary" type="submit" disabled={loading}>
            {loading ? '...' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Sign up' : 'Send reset link'}
          </button>
        </form>

        {googleEnabled && mode !== 'forgot' && (
          <>
            <div className="divider"><span>or</span></div>
            <button className="btn google-btn" type="button" onClick={startGoogle}>
              <span style={{ marginRight: 8 }}>🔐</span> Continue with Google
            </button>
          </>
        )}

        <div className="modal-footer">
          {mode === 'signin' && (
            <>
              <button className="link-btn" type="button" onClick={() => setMode('signup')}>
                Don't have an account? Sign up
              </button>
              <button className="link-btn" type="button" onClick={() => setMode('forgot')}>
                Forgot password?
              </button>
            </>
          )}
          {mode === 'signup' && (
            <button className="link-btn" type="button" onClick={() => setMode('signin')}>
              Already have an account? Sign in
            </button>
          )}
          {mode === 'forgot' && (
            <button className="link-btn" type="button" onClick={() => setMode('signin')}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}