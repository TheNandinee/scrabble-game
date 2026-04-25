import { PrismaClient } from '@prisma/client';
import { log } from './logger.js';

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ||
  new PrismaClient({
    log: ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

// Retry the initial ping. Neon's free tier may take 5-10s to wake from suspend.
async function pingWithRetry(maxAttempts = 5, baseDelayMs = 1500) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      log.info('db.connect.ok', { attempt });
      return true;
    } catch (err) {
      const last = attempt === maxAttempts;
      log.warn('db.connect.retry', {
        attempt,
        maxAttempts,
        err: String(err).split('\n')[0],
      });
      if (last) {
        log.error('db.connect.fail.final', { err: String(err) });
        return false;
      }
      // Exponential-ish backoff (1.5s, 3s, 4.5s, 6s)
      await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
    }
  }
  return false;
}

// Kick off the ping but don't await it here — the boot sequence in index.js
// awaits it before listen() so we don't miss requests.
export const dbReady = pingWithRetry();