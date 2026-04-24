import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { registerSocketHandlers } from './sockets/socketHandlers.js';
import { roomManager } from './rooms/roomManager.js';
import { reconnectTokens } from './rooms/reconnectTokens.js';
import { dictionarySize } from './game/dictionary.js';
import { ROOM_SWEEP_INTERVAL_MS } from './events.js';

const PORT = process.env.PORT || 4000;
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ service: 'scrabble-server', status: 'ok' });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    ...roomManager.stats(),
    dictionaryWords: dictionarySize(),
    uptime: process.uptime(),
  });
});

const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
  pingInterval: 25_000,
  pingTimeout: 20_000,
});

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);
  registerSocketHandlers(io, socket);
});

// Housekeeping: sweep abandoned rooms + expired reconnect tokens every minute
const sweepInterval = setInterval(() => {
  const removed = roomManager.sweepAbandoned();
  reconnectTokens.sweep();
  if (removed > 0) console.log(`[sweep] removed ${removed} abandoned rooms`);
}, ROOM_SWEEP_INTERVAL_MS);

httpServer.listen(PORT, () => {
  console.log(`Scrabble server listening on :${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
});

// Graceful shutdown: stop accepting new connections, close sockets,
// then exit. Prevents corrupt state during Render deploys.
function shutdown(signal) {
  console.log(`[shutdown] received ${signal}, closing...`);
  clearInterval(sweepInterval);
  io.close(() => {
    httpServer.close(() => {
      console.log('[shutdown] complete');
      process.exit(0);
    });
  });
  // Hard exit if it takes too long
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);