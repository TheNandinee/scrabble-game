import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { registerSocketHandlers } from './sockets/socketHandlers.js';
import { roomManager } from './rooms/roomManager.js';

const PORT = process.env.PORT || 4000;

// Allow multiple comma-separated origins in CLIENT_ORIGIN for prod + local dev.
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ service: 'scrabble-server', status: 'ok' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ...roomManager.stats(), uptime: process.uptime() });
});

const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Allow both transports; Render supports WebSocket upgrade.
  transports: ['websocket', 'polling'],
});

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);
  registerSocketHandlers(io, socket);
});

httpServer.listen(PORT, () => {
  console.log(`Scrabble server listening on :${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
});