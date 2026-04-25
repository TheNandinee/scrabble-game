import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function VerifyEmail({ onDone }) {
  const [status, setStatus] = useState('verifying');
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) { setStatus('error'); setError('Missing token'); return; }
    api.verifyEmail(token)
      .then(() => setStatus('done'))
      .catch((err) => { setStatus('error'); setError(err?.message || 'Verification failed'); });
  }, []);

  return (
    <div className="card" style={{ maxWidth: 480, margin: '60px auto' }}>
      {status === 'verifying' && <p>Verifying your email...</p>}
      {status === 'done' && (
        <>
          <h3>Email verified ✅</h3>
          <p className="muted">Thanks! Your account is fully active.</p>
          <button className="btn primary" onClick={onDone}>Continue</button>
        </>
      )}
      {status === 'error' && (
        <>
          <h3>Could not verify</h3>
          <p className="muted">{error}</p>
          <button className="btn" onClick={onDone}>Back</button>
        </>
      )}
    </div>
  );
}