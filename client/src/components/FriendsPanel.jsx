import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { socket } from '../socket.js';
import { EVENTS } from '../events.js';

export default function FriendsPanel({ open, onClose, currentRoomId }) {
  const [tab, setTab] = useState('friends');
  const [data, setData] = useState({ friends: [], incoming: [], outgoing: [] });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [inviting, setInviting] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const debounceRef = useRef(null);

  const refresh = async () => {
    try { setData(await api.friends.list()); } catch {}
  };

  useEffect(() => {
    if (!open) return;
    refresh();
    setError(''); setInfo('');
    const onUpdate = (msg) => {
      if (msg.type === 'list') setData(msg);
      else if (msg.type === 'online' || msg.type === 'offline') {
        setData((d) => ({
          ...d,
          friends: d.friends.map((f) =>
            f.userId === msg.userId ? { ...f, online: msg.type === 'online' } : f
          ),
        }));
      }
    };
    socket.on(EVENTS.FRIENDS_UPDATE, onUpdate);
    return () => socket.off(EVENTS.FRIENDS_UPDATE, onUpdate);
  }, [open]);

  useEffect(() => {
    if (tab !== 'search') return;
    if (!searchQuery || searchQuery.length < 2) { setSearchResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await api.friends.search(searchQuery);
        setSearchResults(r.results || []);
      } catch {}
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery, tab]);

  const sendRequest = async (userId) => {
    setError('');
    try {
      await api.friends.request(userId);
      setSearchResults((rs) =>
        rs.map((r) => r.id === userId
          ? { ...r, relationship: { status: 'pending', sentByMe: true } }
          : r
        )
      );
      refresh();
    } catch (e) { setError(e?.message || 'Could not send request'); }
  };

  const respondRequest = async (friendshipId, accept) => {
    try {
      await api.friends.respond(friendshipId, accept);
      refresh();
    } catch (e) { setError(e?.message || 'Could not respond'); }
  };

  const inviteToGame = async (userId, friendName) => {
    if (!currentRoomId) {
      setError('Create or join a room first, then invite friends.');
      return;
    }
    setInviting(userId);
    setError(''); setInfo('');
    try {
      await api.friends.sendInvite(userId, currentRoomId);
      setInfo(`✉️ Invite sent to ${friendName}!`);
      setTimeout(() => setInfo(''), 3000);
    } catch (e) {
      setError(e?.message || 'Could not send invite');
    } finally {
      setInviting(null);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal friends-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>👥 Friends</h3>
          <button className="btn small ghost" onClick={onClose}>✕</button>
        </div>

        <div className="tab-row">
          <button className={`tab ${tab === 'friends' ? 'active' : ''}`} onClick={() => setTab('friends')}>
            Friends ({data.friends.length})
          </button>
          <button className={`tab ${tab === 'requests' ? 'active' : ''}`} onClick={() => setTab('requests')}>
            Requests {data.incoming.length > 0 && <span className="dot">{data.incoming.length}</span>}
          </button>
          <button className={`tab ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>
            Find people
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {info && <div className="info-banner">{info}</div>}

        {tab === 'friends' && (
          <>
            {data.friends.length === 0 ? (
              <div className="muted" style={{ padding: 32, textAlign: 'center', background: 'var(--bg)', borderRadius: 'var(--radius)' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🤷</div>
                No friends yet. Use "Find people" to add some.
              </div>
            ) : (
              <ul className="people-list">
                {data.friends.map((f) => (
                  <li key={f.userId}>
                    <div className="person">
                      <div className="person-name">
                        <span className={`presence-dot ${f.online ? 'on' : 'off'}`} />
                        {f.displayName}
                      </div>
                      <div className="person-sub">Rating {f.rating}</div>
                    </div>
                    {currentRoomId ? (
                      <button
                        className="btn small primary"
                        disabled={inviting === f.userId}
                        onClick={() => inviteToGame(f.userId, f.displayName)}
                      >
                        {inviting === f.userId ? '...' : 'Invite'}
                      </button>
                    ) : (
                      <span className="muted small">Start a room first</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'requests' && (
          <>
            {data.incoming.length === 0 && data.outgoing.length === 0 && (
              <div className="muted" style={{ padding: 32, textAlign: 'center', background: 'var(--bg)', borderRadius: 'var(--radius)' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
                No pending requests.
              </div>
            )}
            {data.incoming.length > 0 && (
              <>
                <h4 className="subhead">Incoming</h4>
                <ul className="people-list">
                  {data.incoming.map((f) => (
                    <li key={f.friendshipId}>
                      <div className="person">
                        <div className="person-name">{f.displayName}</div>
                        <div className="person-sub">Rating {f.rating}</div>
                      </div>
                      <div className="row">
                        <button className="btn small primary" onClick={() => respondRequest(f.friendshipId, true)}>
                          Accept
                        </button>
                        <button className="btn small ghost" onClick={() => respondRequest(f.friendshipId, false)}>
                          Decline
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {data.outgoing.length > 0 && (
              <>
                <h4 className="subhead">Sent</h4>
                <ul className="people-list">
                  {data.outgoing.map((f) => (
                    <li key={f.friendshipId}>
                      <div className="person">
                        <div className="person-name">{f.displayName}</div>
                        <div className="person-sub">Rating {f.rating}</div>
                      </div>
                      <span className="muted small">⏳ Pending</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {tab === 'search' && (
          <>
            <input
              className="search-input"
              type="text"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            <ul className="people-list">
              {searchResults.map((r) => {
                const rel = r.relationship;
                return (
                  <li key={r.id}>
                    <div className="person">
                      <div className="person-name">
                        <span className={`presence-dot ${r.online ? 'on' : 'off'}`} />
                        {r.displayName}
                      </div>
                      <div className="person-sub">Rating {r.rating}</div>
                    </div>
                    {!rel ? (
                      <button className="btn small primary" onClick={() => sendRequest(r.id)}>
                        Add friend
                      </button>
                    ) : rel.status === 'pending' && rel.sentByMe ? (
                      <span className="muted small">⏳ Pending</span>
                    ) : rel.status === 'pending' && !rel.sentByMe ? (
                      <span className="muted small">📥 Check Requests</span>
                    ) : rel.status === 'accepted' ? (
                      <span className="muted small">✓ Friends</span>
                    ) : null}
                  </li>
                );
              })}
              {searchQuery.length >= 2 && searchResults.length === 0 && (
                <li className="muted" style={{ padding: 16, textAlign: 'center', display: 'block' }}>
                  No results
                </li>
              )}
              {searchQuery.length < 2 && (
                <li className="muted" style={{ padding: 16, textAlign: 'center', display: 'block' }}>
                  Type at least 2 characters to search
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}