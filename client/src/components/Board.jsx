import { BOARD_SIZE } from '../events.js';

const PREMIUM_LAYOUT = (() => {
  const grid = Array.from({ length: 15 }, () => Array(15).fill(null));
  const TW = [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]];
  const DW = [
    [1,1],[2,2],[3,3],[4,4],[1,13],[2,12],[3,11],[4,10],
    [13,1],[12,2],[11,3],[10,4],[13,13],[12,12],[11,11],[10,10],[7,7],
  ];
  const TL = [
    [1,5],[1,9],[5,1],[5,5],[5,9],[5,13],
    [9,1],[9,5],[9,9],[9,13],[13,5],[13,9],
  ];
  const DL = [
    [0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],
    [6,2],[6,6],[6,8],[6,12],[7,3],[7,11],
    [8,2],[8,6],[8,8],[8,12],
    [11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11],
  ];
  TW.forEach(([r,c]) => grid[r][c] = 'TW');
  DW.forEach(([r,c]) => grid[r][c] = 'DW');
  TL.forEach(([r,c]) => grid[r][c] = 'TL');
  DL.forEach(([r,c]) => grid[r][c] = 'DL');
  return grid;
})();

const LETTER_VALUES = {
  A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,
  P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10,_:0,
};

const PREMIUM_LABEL = { TW: 'TW', DW: 'DW', TL: 'TL', DL: 'DL' };

export default function Board({ board, pendingPlacements, onCellClick, isMyTurn }) {
  const pendingMap = new Map();
  (pendingPlacements || []).forEach((p) => pendingMap.set(`${p.row},${p.col}`, p));

  const safeBoard = board && board.length
    ? board
    : Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));

  return (
    <div className={`board ${isMyTurn ? 'active' : 'inactive'}`}>
      {safeBoard.map((row, r) => (
        <div key={r} className="board-row">
          {row.map((cell, c) => {
            const pending = pendingMap.get(`${r},${c}`);
            const premium = PREMIUM_LAYOUT[r][c];
            const isCenter = r === 7 && c === 7;

            let content = null;
            let tileClass = '';
            if (cell) {
              content = (<>
                <span className="letter">{cell.letter}</span>
                <span className="value">{cell.blank ? '' : LETTER_VALUES[cell.letter] || ''}</span>
              </>);
              tileClass = 'placed';
            } else if (pending) {
              content = (<>
                <span className="letter">{pending.letter}</span>
                <span className="value">{pending.blank ? '' : LETTER_VALUES[pending.letter] || ''}</span>
              </>);
              tileClass = 'pending';
            } else if (premium) {
              content = <span className="premium-label">{PREMIUM_LABEL[premium]}</span>;
            } else if (isCenter) {
              content = <span className="premium-label">★</span>;
            }

            const classes = [
              'cell',
              premium ? `p-${premium}` : '',
              tileClass,
              isCenter && !cell && !pending ? 'center' : '',
            ].filter(Boolean).join(' ');

            return (
              <div key={c} className={classes} onClick={() => onCellClick && onCellClick(r, c)}>
                {content}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}