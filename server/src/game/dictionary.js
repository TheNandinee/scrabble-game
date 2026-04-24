import { WORD_LIST } from './wordlist.js';

// Build a Set at module load for O(1) lookups.
const DICTIONARY = new Set(
  WORD_LIST
    .map((w) => String(w).trim().toUpperCase())
    .filter((w) => /^[A-Z]+$/.test(w) && w.length >= 2 && w.length <= 15)
);

console.log(`[dictionary] loaded ${DICTIONARY.size} words`);

export function isValidWord(word) {
  if (!word || typeof word !== 'string') return false;
  const w = word.toUpperCase();
  // Scrabble rule: single-letter "words" are not valid
  if (w.length < 2) return false;
  return DICTIONARY.has(w);
}

export function validateWords(words) {
  // `words` comes from scoring.extractFormedWords; each has { text, cells }
  const invalid = [];
  for (const w of words) {
    if (!w?.text) continue;
    if (w.text === 'BINGO') continue; // pseudo-entry from scoring, not a real word
    if (!isValidWord(w.text)) invalid.push(w.text);
  }
  return { ok: invalid.length === 0, invalid };
}

export function dictionarySize() {
  return DICTIONARY.size;
}