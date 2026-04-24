import { useEffect, useState } from 'react';

export default function TurnTimer({ expiresAt }) {
  const [ms, setMs] = useState(() => Math.max(0, (expiresAt || 0) - Date.now()));

  useEffect(() => {
    if (!expiresAt) { setMs(0); return; }
    const tick = () => setMs(Math.max(0, expiresAt - Date.now()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (!expiresAt) return null;

  const seconds = Math.ceil(ms / 1000);
  const urgent = seconds <= 15;
  const mm = Math.floor(seconds / 60).toString();
  const ss = (seconds % 60).toString().padStart(2, '0');

  return (
    <span className={`timer-pill ${urgent ? 'urgent' : ''}`}>
      ⏱ {mm}:{ss}
    </span>
  );
}