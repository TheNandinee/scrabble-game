import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import { EVENTS } from './events.js';
import Home from './components/Home.jsx';
import Room from './components/Room.jsx';

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [mySocketId, setMySocketId] = useState(socket.id || null);
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      setMySocketId(socket.id);
    };
    const onDisconnect = () => setConnected(false);
    const onRoomState = (view) => setRoom(view);
    const onPlayerJoined = ({ player }) => {
      // ROOM_STATE immediately follows, but this lets us show a transient toast later.
      console.log('[player_joined]', player);
    };
    const onPlayerLeft = ({ playerId }) => {
      console.log('[player_left]', playerId);
    };
    const onGameStarted = (view) => {
      setRoom(view);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(EVENTS.ROOM_STATE, onRoomState);
    socket.on(EVENTS.PLAYER_JOINED, onPlayerJoined);
    socket.on(EVENTS.PLAYER_LEFT, onPlayerLeft);
    socket.on(EVENTS.GAME_STARTED, onGameStarted);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(EVENTS.ROOM_STATE, onRoomState);
      socket.off(EVENTS.PLAYER_JOINED, onPlayerJoined);
      socket.off(EVENTS.PLAYER_LEFT, onPlayerLeft);
      socket.off(EVENTS.GAME_STARTED, onGameStarted);
    };
  }, []);

  const handleCreateRoom = (playerName) => {
    setError('');
    socket.emit(EVENTS.CREATE_ROOM, { playerName }, (res) => {
      if (!res?.ok) {
        setError(res?.error || 'Failed to create room');
        return;
      }
      setRoom(res.room);
    });
  };

  const handleJoinRoom = (roomId, playerName) => {
    setError('');
    socket.emit(EVENTS.JOIN_ROOM, { roomId, playerName }, (res) => {
      if (!res?.ok) {
        setError(res?.error || 'Failed to join room');
        return;
      }
      setRoom(res.room);
    });
  };

  const handleLeaveRoom = () => {
    socket.emit(EVENTS.LEAVE_ROOM, {}, () => {
      setRoom(null);
    });
  };

  const handleStartGame = () => {
    setError('');
    socket.emit(EVENTS.START_GAME, {}, (res) => {
      if (!res?.ok) setError(res?.error || 'Failed to start game');
    });
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Scrabble Multiplayer</h1>
        <span className={`status-dot ${connected ? 'ok' : 'bad'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {!room ? (
        <Home onCreate={handleCreateRoom} onJoin={handleJoinRoom} />
      ) : (
        <Room
          room={room}
          mySocketId={mySocketId}
          onLeave={handleLeaveRoom}
          onStart={handleStartGame}
        />
      )}
    </div>
  );
}