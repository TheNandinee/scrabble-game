// Lightweight wrapper around localStorage for user preferences.

const KEY = 'scrabble-prefs';

const defaults = {
  soundEnabled: true,
  lastName: '',
  rackOrder: null, // optional persisted shuffle order, null = server order
};

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

export function savePrefs(patch) {
  try {
    const current = loadPrefs();
    const next = { ...current, ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadPrefs();
  }
}