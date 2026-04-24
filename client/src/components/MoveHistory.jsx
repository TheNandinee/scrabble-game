export default function MoveHistory({ history, players }) {
  const nameFor = (seatId) =>
    players.find((p) => p.seatId === seatId)?.name || 'Unknown';

  if (!history || history.length === 0) {
    return (
      <div className="card-sm move-history">
        <h3>Move History</h3>
        <div className="muted">No moves yet.</div>
      </div>
    );
  }

  return (
    <div className="card-sm move-history">
      <h3>Move History</h3>
      <ol className="history-list">
        {history.slice().reverse().map((entry, i) => {
          const key = `${entry.turn}-${i}`;
          const who = nameFor(entry.seatId);
          if (entry.type === 'move') {
            const words = (entry.words || [])
              .filter((w) => w.word !== 'BINGO')
              .map((w) => `${w.word} (${w.score})`)
              .join(', ');
            return (
              <li key={key} className="h-move">
                <span className="h-turn">T{entry.turn}</span>
                <span className="h-who">{who}</span>
                <span className="h-words">{words || '—'}</span>
                <span className="h-score">+{entry.score}</span>
              </li>
            );
          }
          if (entry.type === 'pass') {
            return (
              <li key={key} className="h-pass">
                <span className="h-turn">T{entry.turn}</span>
                <span className="h-who">{who}</span>
                <span className="h-tag">passed</span>
              </li>
            );
          }
          if (entry.type === 'timeout') {
            return (
              <li key={key} className="h-pass">
                <span className="h-turn">T{entry.turn}</span>
                <span className="h-who">{who}</span>
                <span className="h-tag">timed out</span>
              </li>
            );
          }
          if (entry.type === 'swap') {
            return (
              <li key={key} className="h-swap">
                <span className="h-turn">T{entry.turn}</span>
                <span className="h-who">{who}</span>
                <span className="h-tag">swapped {entry.count}</span>
              </li>
            );
          }
          return null;
        })}
      </ol>
    </div>
  );
}