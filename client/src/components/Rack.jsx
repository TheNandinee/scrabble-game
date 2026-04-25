const LETTER_VALUES = {
  A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,
  P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10,_:0,
};

export default function Rack({ tiles, selectedIndex, onSelect, onShuffle, enabled }) {
  const safeTiles = Array.isArray(tiles) ? tiles : [];

  const handleDragStart = (e, idx, used) => {
    if (!enabled || used) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', String(idx));
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="rack-row">
      <div className={`rack ${enabled ? '' : 'disabled'}`}>
        {safeTiles.map((tile, i) => {
          const letter = tile?.letter ?? '';
          const idx = tile?.idx ?? i;
          const used = !!tile?.used;
          const isSelected = idx === selectedIndex;
          const display = letter === '_' ? '★' : letter;
          return (
            <button
              key={`${idx}-${i}`}
              className={`rack-tile ${isSelected ? 'selected' : ''} ${used ? 'used' : ''}`}
              disabled={!enabled || used}
              draggable={enabled && !used}
              onDragStart={(e) => handleDragStart(e, idx, used)}
              onClick={() => onSelect(isSelected ? null : idx)}
            >
              <span className="letter">{display}</span>
              <span className="value">{LETTER_VALUES[letter] ?? ''}</span>
            </button>
          );
        })}
        {safeTiles.length === 0 && <div className="muted">Waiting for tiles...</div>}
      </div>
      {onShuffle && safeTiles.length > 0 && (
        <button
          className="btn small shuffle-btn"
          onClick={onShuffle}
          disabled={!enabled}
          title="Shuffle rack (visual only)"
        >
          🔀
        </button>
      )}
    </div>
  );
}