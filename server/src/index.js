import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server as SocketIOServer } from 'socket.io';
import { registerSocketHandlers } from './sockets/socketHandlers.js';
import { roomManager } from './rooms/roomManager.js';
import { reconnectTokens } from './rooms/reconnectTokens.js';
import { dictionarySize } from './game/dictionary.js';
import { ROOM_SWEEP_INTERVAL_MS } from './events.js';
import { log } from './logger.js';
import { prisma } from './db.js';

const PORT = process.env.PORT || 4000;
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '16kb' }));

app.get('/', (_req, res) => res.json({ service: 'scrabble-server', status: 'ok' }));

app.get('/health', async (_req, res) => {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {}
  res.json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk,
    ...roomManager.stats(),
    dictionaryWords: dictionarySize(),
    uptime: process.uptime(),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 16_000,
});

io.on('connection', (socket) => {
  log.info('socket.connect', { socketId: socket.id });
  registerSocketHandlers(io, socket);
});

const sweepInterval = setInterval(async () => {
  try {
    const removed = await roomManager.sweepAbandoned();
    reconnectTokens.sweep();
    if (removed > 0) log.info('rooms.sweep', { removed });
  } catch (err) {
    log.error('sweep.error', { err: String(err) });
  }
}, ROOM_SWEEP_INTERVAL_MS);

// Boot sequence: hydrate from DB *before* accepting connections
async function boot() {
  await roomManager.hydrate();
  httpServer.listen(PORT, () => {
    log.info('server.listen', { port: PORT, origins: allowedOrigins });
  });
}
boot().catch((err) => {
  log.error('server.boot.fail', { err: String(err) });
  process.exit(1);
});

function shutdown(signal) {
  log.info('server.shutdown.start', { signal });
  clearInterval(sweepInterval);
  io.close(() => {
    httpServer.close(async () => {
      await prisma.$disconnect();
      log.info('server.shutdown.complete');
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (err) => log.error('unhandledRejection', { err: String(err) }));
process.on('uncaughtException', (err) => log.error('uncaughtException', { err: String(err), stack: err?.stack }));