import { useEffect, useState } from 'react';
import { socket } from '../socket.js';
import { EVENTS } from '../events.js';

export default function GameInviteToast({ onAccept }) {
  const [invite, setInvite] = useState(null);

  useEffect(() => {
    const onInvite = (msg) => setInvite(msg);
    socket.on(EVENTS.GAME_INVITE_RECEIVED, onInvite);
    return () => socket.off(EVENTS.GAME_INVITE_RECEIVED, onInvite);
  }, []);

  if (!invite) return null;

  const accept = () => {
    socket.emit(EVENTS.GAME_INVITE_RESPOND, { inviteId: invite.inviteId, accept: true }, (res) => {
      if (res?.ok && res.accepted && res.roomId) onAccept(res.roomId);
      setInvite(null);
    });
  };
  const decline = () => {
    socket.emit(EVENTS.GAME_INVITE_RESPOND, { inviteId: invite.inviteId, accept: false }, () => {
      setInvite(null);
    });
  };

  return (
    <div className="invite-toast">
      <div className="invite-content">
        <div style={{ marginBottom: 8 }}>
          🎮 <strong>{invite.fromUser?.displayName || 'Someone'}</strong> invited you to a game!
        </div>
        <div className="row">
          <button className="btn small primary" onClick={accept}>Accept</button>
          <button className="btn small ghost" onClick={decline}>Decline</button>
        </div>
      </div>
    </div>
  );
}