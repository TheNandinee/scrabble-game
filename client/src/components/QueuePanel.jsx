import { useEffect, useState } from 'react';
import { socket } from '../socket.js';
import { EVENTS } from '../events.js';

export default function QueuePanel({ open, onClose }) {
  const [size, setSize] = useState(2);
  const [inQueue, setInQueue] = useState(false);
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    const onState = (msg) => {
      setInQueue(!!msg.inQueue);
      if (!msg.inQueue) setWaitingSeconds(0);
    };
    const onMatched = () => {
      setInQueue(false);
      setWaitingSeconds(0);
    };
    socket.on(EVENTS.QUEUE_STATE, onState);
    socket.on(EVENTS.QUEUE_MATCHED, onMatched);
    return () => {
      socket.off(EVENTS.QUEUE_STATE, onState);
      socket.off(EVENTS.QUEUE_MATCHED, onMatched);
    };
  }, [open]);

  useEffect(() => {
    if (!inQueue) return;
    const start = Date.now();
    setWaitingSeconds(0);
    const id = setInterval(() => setWaitingSeconds(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, [inQueue]);

  const join = () => {
    setError('');
    socket.emit(EVENTS.QUEUE_JOIN, { desiredSize: size }, (res) => {
      if (!res?.ok) setError(res?.error || 'Could not join queue');
    });
  };
  const leave = () => {
    socket.emit(EVENTS.QUEUE_LEAVE, {}, () => {});
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={inQueue ? null : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>⚡ Quick Match</h3>
          <button className="btn small ghost" onClick={onClose} disabled={inQueue}>✕</button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {!inQueue ? (
          <>
            <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
              We'll match you with someone of similar skill. The match window widens as you wait.
            </p>
            <label className="field">
              <span>Game size</span>
              <div className="size-toggle">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    className={`btn ${size === n ? 'primary' : ''}`}
                    onClick={() => setSize(n)}
                  >
                    {n} {n === 1 ? 'player' : 'players'}
                  </button>
                ))}
              </div>
            </label>
            <button className="btn primary" style={{ width: '100%' }} onClick={join}>
              🔍 Find Match
            </button>
          </>
        ) : (
          <div className="queue-status">
            <div className="queue-spinner">⏳</div>
            <h4>Searching for opponents...</h4>
            <div className="queue-elapsed">
              {size} players · waiting {waitingSeconds}s
            </div>
            <p className="muted small" style={{ marginTop: 14 }}>
              Hang tight! Match window expands every few seconds.
            </p>
            <button className="btn ghost" style={{ marginTop: 16 }} onClick={leave}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}