import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from './socket.js';
import { EVENTS } from './events.js';
import Home from './components/Home.jsx';
import Room from './components/Room.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import AuthModal from './components/AuthModal.jsx';
import Profile from './components/Profile.jsx';
import VerifyEmail from './components/VerifyEmail.jsx';
import ResetPassword from './components/ResetPassword.jsx';
import { saveReconnect, loadReconnect, clearReconnect } from './reconnect.js';
import { loadPrefs, savePrefs } from './localPrefs.js';
import { sounds } from './sound.js';
import { api } from './api.js';
import ModeSelect from './components/ModeSelect.jsx';
import FriendsPanel from './components/FriendsPanel.jsx';
import QueuePanel from './components/QueuePanel.jsx';
import GameInviteToast from './components/GameInviteToast.jsx';

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [mySeatId, setMySeatId] = useState(null);
  const [role, setRole] = useState(null);
  const [room, setRoom] = useState(null);
  const [rack, setRack] = useState([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [rejoinAttempted, setRejoinAttempted] = useState(false);
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  // Auth state
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState('signin');
  const [profileOpen, setProfileOpen] = useState(false);

  // Routing (kept simple — single-page)
  const [route, setRoute] = useState(() => {
    const path = window.location.pathname;
    if (path === '/verify-email') return 'verify';
    if (path === '/reset-password') return 'reset';
    return 'home';
  });

  const lastNameRef = useRef('');
  const prevTurnRef = useRef(null);

  const flashToast = useCallback((text, ms = 2500) => {
    setToast(text);
    const id = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(id);
  }, []);

  const playIfEnabled = useCallback((fnName) => {
    if (!prefs.soundEnabled) return;
    sounds[fnName]?.();
  }, [prefs.soundEnabled]);

  const toggleSound = useCallback(() => {
    setPrefs((p) => savePrefs({ soundEnabled: !p.soundEnabled }));
  }, []);

  // ----- Bootstrap auth -----
  useEffect(() => {
    api.me()
      .then(({ user }) => setUser(user || null))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
    // Show auth_error if redirected back from OAuth failure
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_error')) {
      setError('Sign in failed. Please try again.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // ----- Connection / rejoin -----
  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      if (!rejoinAttempted) {
        setRejoinAttempted(true);
        const saved = loadReconnect();
        if (saved?.reconnectToken) {
          socket.emit(EVENTS.REJOIN_ROOM, { reconnectToken: saved.reconnectToken }, (res) => {
            if (res?.ok && res.room && res.seatId) {
              setMySeatId(res.seatId);
              setRole('player');
              setRoom(res.room);
              lastNameRef.current = saved.name || '';
              saveReconnect({
                roomId: res.room.id,
                seatId: res.seatId,
                reconnectToken: res.reconnectToken,
                name: saved.name,
              });
              flashToast('Reconnected to your game');
            } else {
              clearReconnect();
            }
          });
        }
      }
    };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected && !rejoinAttempted) onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [rejoinAttempted, flashToast]);

  // ----- Game events -----
  useEffect(() => {
    const onRoomState = (view) => setRoom(view);
    const onRackUpdate = ({ rack }) => setRack(rack || []);
    const onMoveApplied = ({ seatId, score, words }) => {
      const wordList = (words || []).filter((w) => w.word !== 'BINGO').map((w) => w.word).join(', ');
      const isMe = seatId === mySeatId;
      flashToast(`${isMe ? 'You' : 'Opponent'} scored ${score}${wordList ? ` (${wordList})` : ''}`);
      playIfEnabled('submit');
    };
    const onMoveRejected = ({ error, invalidWords }) => {
      if (invalidWords?.length) flashToast(`Not in dictionary: ${invalidWords.join(', ')}`, 4000);
      else flashToast(`Invalid move: ${error}`, 3500);
      playIfEnabled('reject');
    };
    const onGameEnded = ({ reason, finalScores }) => {
      flashToast(`Game over (${reason}).`, 5000);
      setRoom((r) => (r ? { ...r, status: 'finished', scores: finalScores } : r));
      playIfEnabled('win');
      // Refresh user stats since they may have updated
      api.me().then(({ user }) => setUser(user || null)).catch(() => {});
    };
    const onPlayerJoined = ({ player }) => flashToast(`${player.name} joined`);
    const onPlayerDisconnected = ({ seatId }) => {
      setRoom((r) => {
        if (!r) return r;
        const name = r.players?.find((p) => p.seatId === seatId)?.name || 'A player';
        flashToast(`${name} disconnected (grace period)`, 3000);
        return r;
      });
    };
    const onPlayerReconnected = ({ name }) => flashToast(`${name} reconnected`);
    const onSpectatorJoined = ({ name }) => flashToast(`${name} is spectating`);
    const onTurnTimeout = ({ seatId }) => {
      const name = room?.players?.find((p) => p.seatId === seatId)?.name || 'Player';
      flashToast(`${name} timed out`, 2500);
    };
    const onGameStarted = (view) => { setRoom(view); flashToast('Game started!'); };
    const onQueueMatched = (msg) => {
      setMySeatId(msg.seatId);
      setRole('player');
      setRoom(msg.room);
      setQueueOpen(false);
      saveReconnect({
        roomId: msg.room.id,
        seatId: msg.seatId,
        reconnectToken: msg.reconnectToken,
        name: user?.displayName || 'Player',
      });
      flashToast('Match found!');
    };

    socket.on(EVENTS.ROOM_STATE, onRoomState);
    socket.on(EVENTS.RACK_UPDATE, onRackUpdate);
    socket.on(EVENTS.MOVE_APPLIED, onMoveApplied);
    socket.on(EVENTS.MOVE_REJECTED, onMoveRejected);
    socket.on(EVENTS.GAME_ENDED, onGameEnded);
    socket.on(EVENTS.PLAYER_JOINED, onPlayerJoined);
    socket.on(EVENTS.PLAYER_DISCONNECTED, onPlayerDisconnected);
    socket.on(EVENTS.PLAYER_RECONNECTED, onPlayerReconnected);
    socket.on(EVENTS.SPECTATOR_JOINED, onSpectatorJoined);
    socket.on(EVENTS.TURN_TIMEOUT, onTurnTimeout);
    socket.on(EVENTS.GAME_STARTED, onGameStarted);
    socket.on(EVENTS.QUEUE_MATCHED, onQueueMatched);

    return () => {
      socket.off(EVENTS.ROOM_STATE, onRoomState);
      socket.off(EVENTS.RACK_UPDATE, onRackUpdate);
      socket.off(EVENTS.MOVE_APPLIED, onMoveApplied);
      socket.off(EVENTS.MOVE_REJECTED, onMoveRejected);
      socket.off(EVENTS.GAME_ENDED, onGameEnded);
      socket.off(EVENTS.PLAYER_JOINED, onPlayerJoined);
      socket.off(EVENTS.PLAYER_DISCONNECTED, onPlayerDisconnected);
      socket.off(EVENTS.PLAYER_RECONNECTED, onPlayerReconnected);
      socket.off(EVENTS.SPECTATOR_JOINED, onSpectatorJoined);
      socket.off(EVENTS.TURN_TIMEOUT, onTurnTimeout);
      socket.off(EVENTS.GAME_STARTED, onGameStarted);
      socket.off(EVENTS.QUEUE_MATCHED, onQueueMatched);
    };
  }, [mySeatId, flashToast, room, playIfEnabled, user]);

  useEffect(() => {
    if (!room || role !== 'player') return;
    const nowMyTurn = room.currentTurnSeatId === mySeatId;
    const wasMyTurn = prevTurnRef.current === mySeatId;
    if (nowMyTurn && !wasMyTurn && room.status === 'in_progress') {
      playIfEnabled('yourTurn');
    }
    prevTurnRef.current = room.currentTurnSeatId;
  }, [room, mySeatId, role, playIfEnabled]);

  // ----- Auth handlers -----
  const handleAuthed = (u) => {
    setUser(u);
    flashToast(`Welcome, ${u.displayName}!`);
    // Reconnect socket so the server can re-read the auth cookie
    if (!room) {
      socket.disconnect();
      socket.connect();
    }
  };
  const handleSignout = async () => {
    try { await api.signout(); } catch {}
    setUser(null);
    setProfileOpen(false);
    flashToast('Signed out');
    if (!room) {
      socket.disconnect();
      socket.connect();
    }
  };

  // ----- Game handlers -----
  const persistSession = (res, name) => {
    if (!res?.ok) return;
    saveReconnect({
      roomId: res.room.id,
      seatId: res.seatId,
      reconnectToken: res.reconnectToken,
      name,
    });
  };
  const handleCreateRoom = (playerName) => {
    setError(''); lastNameRef.current = playerName;
    socket.emit(EVENTS.CREATE_ROOM, { playerName }, (res) => {
      if (!res?.ok) return setError(res?.error || 'Failed to create room');
      setMySeatId(res.seatId); setRole('player'); setRoom(res.room);
      persistSession(res, playerName);
    });
  };
  const handleJoinRoom = (roomId, playerName) => {
    setError(''); lastNameRef.current = playerName;
    socket.emit(EVENTS.JOIN_ROOM, { roomId, playerName }, (res) => {
      if (!res?.ok) return setError(res?.error || 'Failed to join room');
      setMySeatId(res.seatId); setRole('player'); setRoom(res.room);
      persistSession(res, playerName);
    });
  };
  const handleSpectateRoom = (roomId, spectatorName) => {
    setError('');
    socket.emit(EVENTS.SPECTATE_ROOM, { roomId, spectatorName }, (res) => {
      if (!res?.ok) return setError(res?.error || 'Failed to spectate');
      setRoom(res.room); setRole('spectator'); setMySeatId(null);
    });
  };
  const handleLeaveRoom = () => {
    socket.emit(EVENTS.LEAVE_ROOM, {}, () => {
      setRoom(null); setRack([]); setMySeatId(null); setRole(null);
      clearReconnect();
    });
  };
  const handleStartGame = () => {
    setError('');
    socket.emit(EVENTS.START_GAME, {}, (res) => {
      if (!res?.ok) setError(res?.error || 'Failed to start game');
    });
  };
  const handleSubmitMove = (placements) => new Promise((resolve) => {
    socket.emit(EVENTS.SUBMIT_MOVE, { placements }, (res) => resolve(res));
  });
  const handlePass = () => {
    socket.emit(EVENTS.PASS_TURN, {}, (res) => {
      if (!res?.ok) flashToast(res?.error || 'Cannot pass');
    });
  };
  const handleSwap = (tiles) => new Promise((resolve) => {
    socket.emit(EVENTS.SWAP_TILES, { tiles }, (res) => {
      if (!res?.ok) flashToast(res?.error || 'Cannot swap');
      resolve(res);
    });
  });

  // ----- Phase 7 mode-pick handlers -----
  const handlePickFriend = ({ joinCode } = {}) => {
    if (joinCode) {
      handleJoinRoom(joinCode, user?.displayName || prefs.lastName || 'Player');
    } else {
      handleCreateRoom(user?.displayName || prefs.lastName || 'Player');
    }
  };

  const handleAcceptGameInvite = (roomId) => {
    handleJoinRoom(roomId, user?.displayName || prefs.lastName || 'Player');
  };

  const goHome = () => {
    setRoute('home');
    window.history.replaceState({}, '', '/');
  };

  // ----- Render -----
  return (
    <ErrorBoundary>
      <div className="app">
        <header className="app-header">
          <h1 onClick={goHome} style={{ cursor: 'pointer' }}>Scrabble Multiplayer</h1>
          <div className="header-right">
            {authChecked && (
              user ? (
                <>
                  <button className="btn small" onClick={() => setFriendsOpen(true)}>
                    👥 Friends
                  </button>
                  <button className="btn small user-pill" onClick={() => setProfileOpen(true)}>
                    👤 {user.displayName}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn small" onClick={() => { setAuthModalMode('signin'); setAuthModalOpen(true); }}>
                    Sign in
                  </button>
                  <button className="btn small primary" onClick={() => { setAuthModalMode('signup'); setAuthModalOpen(true); }}>
                    Sign up
                  </button>
                </>
              )
            )}
            <button className="btn small icon-btn" onClick={toggleSound} title={prefs.soundEnabled ? 'Mute' : 'Unmute'}>
              {prefs.soundEnabled ? '🔊' : '🔇'}
            </button>
            <span className={`status-dot ${connected ? 'ok' : 'bad'}`}>
              {connected ? 'Connected' : 'Reconnecting...'}
            </span>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}
        {toast && <div className="toast">{toast}</div>}

        {route === 'verify' && <VerifyEmail onDone={goHome} />}
        {route === 'reset' && <ResetPassword onDone={goHome} onAuthed={handleAuthed} />}

        {route === 'home' && !room && (
          <ModeSelect
            user={user}
            onPickFriend={handlePickFriend}
            onPickQuickMatch={() => setQueueOpen(true)}
            onPickComputer={() => flashToast('Computer opponent coming in Phase 8!')}
            onSpectate={(code) => handleSpectateRoom(code, user?.displayName || 'Spectator')}
            onSignInClick={() => { setAuthModalMode('signin'); setAuthModalOpen(true); }}
          />
        )}

        {route === 'home' && room && (
          <Room
            room={room}
            rack={rack}
            mySeatId={mySeatId}
            role={role}
            onLeave={handleLeaveRoom}
            onStart={handleStartGame}
            onSubmitMove={handleSubmitMove}
            onPass={handlePass}
            onSwap={handleSwap}
            soundEnabled={prefs.soundEnabled}
            playSound={playIfEnabled}
          />
        )}

        <AuthModal
          open={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onAuthed={handleAuthed}
          defaultMode={authModalMode}
        />
        {user && profileOpen && (
          <Profile
            user={user}
            onClose={() => setProfileOpen(false)}
            onUpdated={(u) => setUser(u)}
            onSignout={handleSignout}
          />
        )}

        <FriendsPanel
          open={friendsOpen}
          onClose={() => setFriendsOpen(false)}
          currentRoomId={room?.id || null}
        />
        <QueuePanel
          open={queueOpen}
          onClose={() => setQueueOpen(false)}
          onMatched={(_msg) => { /* handled by socket listener */ }}
        />
        <GameInviteToast onAccept={handleAcceptGameInvite} />
      </div>
    </ErrorBoundary>
  );
}