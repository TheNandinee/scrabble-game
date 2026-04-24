import { useEffect, useState } from 'react';

export default function Home({ onCreate, onJoin }) {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');

  // Auto-fill ?room=XXXX from shareable link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('room');
    if (r) setRoomId(r.toUpperCase());
  }, []);

  const canCreate = name.trim().length > 0;
  const canJoin = name.trim().length > 0 && roomId.trim().length > 0;

  return (
    <div className="home">
      <div className="card">
        <h2>Join or Create a Game</h2>

        <label className="field">
          <span>Your name</span>
          <input
            type="text"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alex"
          />
        </label>

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
            onClick={() => onJoin(roomId.trim().toUpperCase(), name.trim())}
          >
            Join Room
          </button>
        </div>
      </div>
    </div>
  );
}