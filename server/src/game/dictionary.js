import { WORD_LIST } from './wordlist.js';
import { log } from '../logger.js';

/**
 * Dictionary loader.
 *
 * WORD_LIST may be:
 *   - an array of strings (small bundled list), OR
 *   - a single big string (newline/space-separated, e.g. when you paste in SOWPODS)
 *
 * Both are accepted to make swapping in a 270k word list trivial.
 */
function normalizeSource(src) {
  if (Array.isArray(src)) return src;
  if (typeof src === 'string') return src.split(/\s+/);
  return [];
}

const DICTIONARY = new Set(
  normalizeSource(WORD_LIST)
    .map((w) => String(w).trim().toUpperCase())
    .filter((w) => /^[A-Z]+$/.test(w) && w.length >= 2 && w.length <= 15)
);

log.info('dictionary.load', { words: DICTIONARY.size });

export function isValidWord(word) {
  if (!word || typeof word !== 'string') return false;
  const w = word.toUpperCase();
  if (w.length < 2) return false;
  return DICTIONARY.has(w);
}

export function validateWords(words) {
  const invalid = [];
  for (const w of words) {
    if (!w?.text) continue;
    if (w.text === 'BINGO') continue;
    if (!isValidWord(w.text)) invalid.push(w.text);
  }
  return { ok: invalid.length === 0, invalid };
}

export function dictionarySize() {
  return DICTIONARY.size;
}