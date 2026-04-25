import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function AuthModal({ open, onClose, onAuthed, defaultMode = 'signin' }) {
  const [mode, setMode] = useState(defaultMode);
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
        setInfo("If that email is registered, we've sent you a reset link.");
      }
    } catch (err) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const startGoogle = () => { window.location.href = `${api.serverUrl}/auth/google`; };

  const headings = {
    signin: { title: '👋 Welcome back', sub: 'Sign in to continue your game' },
    signup: { title: '✨ Create account', sub: 'Save your stats and play with friends' },
    forgot: { title: '🔑 Reset password', sub: "We'll send a reset link to your email" },
  };
  const h = headings[mode];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{h.title}</h3>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{h.sub}</p>
          </div>
          <button className="btn small ghost" onClick={onClose}>✕</button>
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
                placeholder="What others will see"
                autoFocus
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
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus={mode !== 'signup'}
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
                placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={8}
                required
              />
            </label>
          )}
          <button className="btn primary" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Loading...' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </button>
        </form>

        {googleEnabled && mode !== 'forgot' && (
          <>
            <div className="divider"><span>or</span></div>
            <button className="btn google-btn" type="button" onClick={startGoogle}>
              <span style={{ fontSize: 16 }}>🔐</span> Continue with Google
            </button>
          </>
        )}

        <div className="modal-footer">
          {mode === 'signin' && (
            <>
              <button className="link-btn" type="button" onClick={() => setMode('signup')}>
                Don't have an account? <strong>Sign up</strong>
              </button>
              <button className="link-btn" type="button" onClick={() => setMode('forgot')}>
                Forgot password?
              </button>
            </>
          )}
          {mode === 'signup' && (
            <button className="link-btn" type="button" onClick={() => setMode('signin')}>
              Already have an account? <strong>Sign in</strong>
            </button>
          )}
          {mode === 'forgot' && (
            <button className="link-btn" type="button" onClick={() => setMode('signin')}>
              ← Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}