import { useEffect, useState } from 'react';
import { socket } from '../socket.js';
import { EVENTS } from '../events.js';

export default function QueuePanel({ open, onClose, onMatched }) {
  const [size, setSize] = useState(2);
  const [inQueue, setInQueue] = useState(false);
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const onState = (msg) => {
      setInQueue(!!msg.inQueue);
      if (!msg.inQueue) setWaitingSeconds(0);
    };
    const onMatched = (msg) => {
      setInQueue(false);
      setWaitingSeconds(0);
      onMatchedCb?.(msg);
    };
    socket.on(EVENTS.QUEUE_STATE, onState);
    socket.on(EVENTS.QUEUE_MATCHED, onMatched);
    return () => {
      socket.off(EVENTS.QUEUE_STATE, onState);
      socket.off(EVENTS.QUEUE_MATCHED, onMatched);
    };
  }, [open]);

  // Tick the elapsed counter while in queue
  useEffect(() => {
    if (!inQueue) return;
    const start = Date.now();
    setWaitingSeconds(0);
    const id = setInterval(() => setWaitingSeconds(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, [inQueue]);

  // Listen for matched event passed into onMatched
  // (We define it once on mount; the parent's onMatched handler will navigate to the room)
  // Trick to call parent handler: stash latest in a ref
  const onMatchedCb = onMatched;

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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Quick Match</h3>
          <button className="btn small" onClick={onClose} disabled={inQueue}>✕</button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {!inQueue ? (
          <>
            <div className="muted" style={{ marginBottom: 12 }}>
              Find a random opponent. We'll match you with someone of similar rating.
            </div>
            <div className="size-toggle">
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  className={`btn ${size === n ? 'primary' : ''}`}
                  onClick={() => setSize(n)}
                >
                  {n} player{n > 1 ? 's' : ''}
                </button>
              ))}
            </div>
            <button className="btn primary" style={{ width: '100%' }} onClick={join}>
              Find Match
            </button>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <div className="queue-spinner">⏳</div>
            <h4>Searching for opponents...</h4>
            <div className="muted">{size} players · waiting {waitingSeconds}s</div>
            <div className="muted small" style={{ marginTop: 12 }}>
              Match window widens as you wait. Hang tight!
            </div>
            <button className="btn" style={{ marginTop: 16 }} onClick={leave}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}