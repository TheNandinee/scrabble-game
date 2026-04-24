import { randomBytes } from 'crypto';

/**
 * Short-lived token -> { roomId, seatId (stable player id) }.
 * A "seat" is the logical player slot. When a socket disconnects we keep their
 * seat in the room for RECONNECT_GRACE_MS so they can rejoin with the same
 * name, rack, and score.
 */
class ReconnectTokens {
  constructor() {
    this.tokens = new Map(); // token -> { roomId, seatId, name, expiresAt }
  }

  issue(roomId, seatId, name, ttlMs) {
    const token = randomBytes(16).toString('hex');
    this.tokens.set(token, {
      roomId,
      seatId,
      name,
      expiresAt: Date.now() + ttlMs,
    });
    return token;
  }

  consume(token) {
    const record = this.tokens.get(token);
    if (!record) return null;
    if (record.expiresAt < Date.now()) {
      this.tokens.delete(token);
      return null;
    }
    // one-time use: remove after successful rejoin
    this.tokens.delete(token);
    return record;
  }

  sweep() {
    const now = Date.now();
    for (const [token, rec] of this.tokens.entries()) {
      if (rec.expiresAt < now) this.tokens.delete(token);
    }
  }
}

export const reconnectTokens = new ReconnectTokens();