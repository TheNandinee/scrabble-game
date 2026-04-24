/**
 * Simple per-socket, per-event rate limiter.
 * Token bucket: `capacity` tokens, refilling at `refillPerMs`.
 * Rejects excess events quickly to protect the server from a misbehaving
 * or compromised client.
 */
export function createSocketRateLimiter({ capacity = 10, refillMs = 1000 } = {}) {
  const buckets = new Map(); // socketId -> { tokens, last }

  return {
    allow(socketId) {
      const now = Date.now();
      let b = buckets.get(socketId);
      if (!b) {
        b = { tokens: capacity, last: now };
        buckets.set(socketId, b);
      }
      // Refill
      const elapsed = now - b.last;
      const refill = (elapsed / refillMs) * capacity;
      b.tokens = Math.min(capacity, b.tokens + refill);
      b.last = now;
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      return true;
    },
    forget(socketId) {
      buckets.delete(socketId);
    },
  };
}