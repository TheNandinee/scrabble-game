import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

export const socket = io(URL, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
});

socket.on('connect', () => {
  console.log('[socket] connected', socket.id);
});

socket.on('disconnect', (reason) => {
  console.log('[socket] disconnected', reason);
});

socket.on('connect_error', (err) => {
  console.warn('[socket] connect_error:', err.message);
});