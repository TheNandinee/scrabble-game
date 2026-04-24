import { TURN_DURATION_MS } from '../events.js';

/**
 * Thin wrapper around setTimeout so sockets layer can cancel/reset timers
 * without remembering the handle everywhere.
 */
export class TurnTimer {
  constructor() {
    this.handle = null;
    this.startedAt = null;
    this.expiresAt = null;
  }

  start(onExpire) {
    this.cancel();
    this.startedAt = Date.now();
    this.expiresAt = this.startedAt + TURN_DURATION_MS;
    this.handle = setTimeout(() => {
      this.handle = null;
      onExpire();
    }, TURN_DURATION_MS);
  }

  cancel() {
    if (this.handle) {
      clearTimeout(this.handle);
      this.handle = null;
    }
    this.startedAt = null;
    this.expiresAt = null;
  }

  remainingMs() {
    if (!this.expiresAt) return 0;
    return Math.max(0, this.expiresAt - Date.now());
  }
}