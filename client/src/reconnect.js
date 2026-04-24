// Stores/retrieves reconnect credentials in localStorage so a page refresh
// or brief network blip can resume the same seat.
const KEY = 'scrabble-reconnect';

export function saveReconnect({ roomId, seatId, reconnectToken, name }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      roomId, seatId, reconnectToken, name, savedAt: Date.now(),
    }));
  } catch { /* storage disabled */ }
}

export function loadReconnect() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Drop anything older than 10 minutes — stale by then
    if (Date.now() - (parsed.savedAt || 0) > 10 * 60_000) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearReconnect() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}