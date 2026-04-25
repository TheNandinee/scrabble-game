import { TILE_DISTRIBUTION } from './constants.js';

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createTileBag() {
  const tiles = [];
  for (const [letter, count] of Object.entries(TILE_DISTRIBUTION)) {
    for (let i = 0; i < count; i++) tiles.push(letter);
  }
  return shuffle(tiles);
}

export function drawTiles(bag, count) {
  const drawn = bag.splice(0, Math.min(count, bag.length));
  return { drawn, bag };
}

export function returnTiles(bag, tiles) {
  const combined = bag.concat(tiles);
  return shuffle(combined);
}