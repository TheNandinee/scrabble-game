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

const PORT = process.env.PORT || 4000;
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);

const app = express();

// helmet sets sensible default security headers. Disable CSP because we don't
// serve HTML from this origin, and Socket.io handles its own framing.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Strict body limit — we accept tiny JSON payloads at most
app.use(express.json({ limit: '16kb' }));

app.get('/', (_req, res) => {
  res.json({ service: 'scrabble-server', status: 'ok' });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
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
  maxHttpBufferSize: 16_000, // 16 KB — moves are tiny; protects from abuse
});

io.on('connection', (socket) => {
  log.info('socket.connect', { socketId: socket.id, ip: socket.handshake.address });
  registerSocketHandlers(io, socket);
});

const sweepInterval = setInterval(() => {
  const removed = roomManager.sweepAbandoned();
  reconnectTokens.sweep();
  if (removed > 0) log.info('rooms.sweep', { removed });
}, ROOM_SWEEP_INTERVAL_MS);

httpServer.listen(PORT, () => {
  log.info('server.listen', { port: PORT, origins: allowedOrigins });
});

function shutdown(signal) {
  log.info('server.shutdown.start', { signal });
  clearInterval(sweepInterval);
  io.close(() => {
    httpServer.close(() => {
      log.info('server.shutdown.complete');
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('unhandledRejection', (err) => log.error('unhandledRejection', { err: String(err) }));
process.on('uncaughtException', (err) => {
  log.error('uncaughtException', { err: String(err), stack: err?.stack });
  // Don't auto-exit — the room manager can keep going even after a single handler crash.
});