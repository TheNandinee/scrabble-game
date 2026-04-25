import { randomBytes } from 'crypto';

class ReconnectTokens {
  constructor() {
    this.tokens = new Map();
  }

  issue(roomId, seatId, name, ttlMs) {
    const token = randomBytes(16).toString('hex');
    this.tokens.set(token, {
      roomId, seatId, name,
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