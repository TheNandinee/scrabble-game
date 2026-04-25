export default function Scoreboard({
  players, scores, currentTurnSeatId, mySeatId, rackCounts,
}) {
  const safePlayers = Array.isArray(players) ? players : [];
  const safeScores = scores || {};
  const sorted = safePlayers.slice().sort(
    (a, b) => (safeScores[b.seatId] || 0) - (safeScores[a.seatId] || 0)
  );

  return (
    <div className="scoreboard card-sm">
      <h3>Scores</h3>
      <ul>
        {sorted.map((p) => {
          const isMe = p.seatId === mySeatId;
          const isTurn = p.seatId === currentTurnSeatId;
          return (
            <li
              key={p.seatId}
              className={[
                isTurn ? 'turn' : '',
                isMe ? 'me' : '',
                p.connected === false ? 'offline' : '',
              ].join(' ')}
            >
              <span className="pname">
                {p.name}
                {isMe && <span className="tag you">you</span>}
                {isTurn && <span className="tag turn-tag">turn</span>}
                {p.connected === false && <span className="tag offline-tag">offline</span>}
              </span>
              <span className="score">{safeScores[p.seatId] || 0}</span>
              <span className="tile-count">
                {(rackCounts && rackCounts[p.seatId] !== undefined) ? `${rackCounts[p.seatId]}🁢` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}