import { verifyJWT } from './tokens.js';
import { prisma } from '../db.js';

/**
 * Reads the JWT from the auth cookie, verifies it, and attaches
 * { id, email } to req.user. Does NOT require auth — leaves req.user undefined
 * if no token. Use `requireAuth` for routes that need a logged-in user.
 */
export async function attachUser(req, _res, next) {
  const token = req.cookies?.auth_token;
  if (!token) return next();
  const payload = verifyJWT(token);
  if (!payload?.userId) return next();
  // Verify user still exists (cheap; can cache later)
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, displayName: true, emailVerified: true },
  });
  if (user) req.user = user;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

/**
 * For socket.io: extract userId from the auth_token cookie sent during handshake.
 * Returns null for anonymous sockets.
 */
export function authenticateSocket(socket) {
  const cookies = parseCookies(socket.handshake.headers.cookie || '');
  const token = cookies.auth_token;
  if (!token) return null;
  const payload = verifyJWT(token);
  return payload?.userId || null;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = decodeURIComponent(pair.slice(idx + 1).trim());
    if (k) out[k] = v;
  }
  return out;
}