import { PrismaClient } from '@prisma/client';
import { log } from './logger.js';

// Singleton — Prisma docs strongly recommend a single instance per process.
// In dev, hot-reload can create multiple; this guards against that.
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ||
  new PrismaClient({
    log: ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

// Test connection on boot
prisma.$connect()
  .then(() => log.info('db.connect.ok'))
  .catch((err) => {
    log.error('db.connect.fail', { err: String(err) });
    process.exit(1);
  });