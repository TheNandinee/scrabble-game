import { useCallback, useEffect, useState } from 'react';
import { socket } from './socket.js';
import { EVENTS } from './events.js';
import Home from './components/Home.jsx';
import Room from './components/Room.jsx';

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [mySocketId, setMySocketId] = useState(socket.id || null);
  const [room, setRoom] = useState(null);
  const [rack, setRack] = useState([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  const flashToast = useCallback((text, ms = 2500) => {
    setToast(text);
    setTimeout(() => setToast(null), ms);
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      setMySocketId(socket.id);
    };
    const onDisconnect = () => setConnected(false);
    const onRoomState = (view) => setRoom(view);
    const onRackUpdate = ({ rack }) => setRack(rack || []);
    const onMoveApplied = ({ playerId, score, words }) => {
      const wordList = (words || []).filter((w) => w.word !== 'BINGO').map((w) => w.word).join(', ');
      const isMe = playerId === socket.id;
      const who = isMe ? 'You' : 'Opponent';
      flashToast(`${who} scored ${score}${wordList ? ` (${wordList})` : ''}`);
    };
    const onGameEnded = ({ reason, finalScores }) => {
      flashToast(`Game over (${reason}).`, 5000);
      setRoom((r) => (r ? { ...r, status: 'finished', scores: finalScores } : r));
    };
    const onPlayerJoined = ({ player }) => flashToast(`${player.name} joined`);
    const onPlayerLeft = () => {/* room_state follows */};
    const onGameStarted = (view) => {
      setRoom(view);
      flashToast('Game started!');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(EVENTS.ROOM_STATE, onRoomState);
    socket.on(EVENTS.RACK_UPDATE, onRackUpdate);
    socket.on(EVENTS.MOVE_APPLIED, onMoveApplied);
    socket.on(EVENTS.GAME_ENDED, onGameEnded);
    socket.on(EVENTS.PLAYER_JOINED, onPlayerJoined);
    socket.on(EVENTS.PLAYER_LEFT, onPlayerLeft);
    socket.on(EVENTS.GAME_STARTED, onGameStarted);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(EVENTS.ROOM_STATE, onRoomState);
      socket.off(EVENTS.RACK_UPDATE, onRackUpdate);
      socket.off(EVENTS.MOVE_APPLIED, onMoveApplied);
      socket.off(EVENTS.GAME_ENDED, onGameEnded);
      socket.off(EVENTS.PLAYER_JOINED, onPlayerJoined);
      socket.off(EVENTS.PLAYER_LEFT, onPlayerLeft);
      socket.off(EVENTS.GAME_STARTED, onGameStarted);
    };
  }, [flashToast]);

  const handleCreateRoom = (playerName) => {
    setError('');
    socket.emit(EVENTS.CREATE_ROOM, { playerName }, (res) => {
      if (!res?.ok) return setError(res?.error || 'Failed to create room');
      setRoom(res.room);
    });
  };

  const handleJoinRoom = (roomId, playerName) => {
    setError('');
    socket.emit(EVENTS.JOIN_ROOM, { roomId, playerName }, (res) => {
      if (!res?.ok) return setError(res?.error || 'Failed to join room');
      setRoom(res.room);
    });
  };

  const handleLeaveRoom = () => {
    socket.emit(EVENTS.LEAVE_ROOM, {}, () => {
      setRoom(null);
      setRack([]);
    });
  };

  const handleStartGame = () => {
    setError('');
    socket.emit(EVENTS.START_GAME, {}, (res) => {
      if (!res?.ok) setError(res?.error || 'Failed to start game');
    });
  };

  const handleSubmitMove = (placements) => {
    return new Promise((resolve) => {
      socket.emit(EVENTS.SUBMIT_MOVE, { placements }, (res) => {
        if (!res?.ok) flashToast(`Invalid move: ${res?.error || 'error'}`);
        resolve(res);
      });
    });
  };

  const handlePass = () => {
    socket.emit(EVENTS.PASS_TURN, {}, (res) => {
      if (!res?.ok) flashToast(res?.error || 'Cannot pass');
    });
  };

  const handleSwap = (tiles) => {
    return new Promise((resolve) => {
      socket.emit(EVENTS.SWAP_TILES, { tiles }, (res) => {
        if (!res?.ok) flashToast(res?.error || 'Cannot swap');
        resolve(res);
      });
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
      {toast && <div className="toast">{toast}</div>}

      {!room ? (
        <Home onCreate={handleCreateRoom} onJoin={handleJoinRoom} />
      ) : (
        <Room
          room={room}
          rack={rack}
          mySocketId={mySocketId}
          onLeave={handleLeaveRoom}
          onStart={handleStartGame}
          onSubmitMove={handleSubmitMove}
          onPass={handlePass}
          onSwap={handleSwap}
        />
      )}
    </div>
  );
}