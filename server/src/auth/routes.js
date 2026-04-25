import express from 'express';
import { prisma } from '../db.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { signJWT, generateRandomToken, expiresIn } from './tokens.js';
import { sendVerificationEmail, sendPasswordResetEmail } from './email.js';
import { requireAuth } from './middleware.js';
import { log } from '../logger.js';

const router = express.Router();

// ---------- helpers ----------

const COOKIE_NAME = 'auth_token';
const isProd = process.env.NODE_ENV === 'production';

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
  });
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    emailVerified: u.emailVerified,
    avatarUrl: u.avatarUrl || null,
    rating: u.rating,
    gamesPlayed: u.gamesPlayed,
    gamesWon: u.gamesWon,
    highestScore: u.highestScore,
  };
}

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
}
function isValidPassword(s) {
  return typeof s === 'string' && s.length >= 8 && s.length <= 100;
}
function isValidName(s) {
  return typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= 30;
}

// ---------- SIGNUP ----------
router.post('/signup', async (req, res) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });
    if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be 8+ characters' });
    if (!isValidName(displayName)) return res.status(400).json({ error: 'Invalid display name' });

    const emailLower = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { emailLower } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await hashPassword(password);
    const verifyToken = generateRandomToken(24);

    const user = await prisma.user.create({
      data: {
        email: email.trim(),
        emailLower,
        passwordHash,
        displayName: displayName.trim(),
        emailVerifyToken: verifyToken,
        emailVerifyExpires: expiresIn(24 * 60 * 60 * 1000),
      },
    });

    sendVerificationEmail(user.email, user.displayName, verifyToken).catch((err) =>
      log.warn('email.verification.fail', { err: String(err) })
    );

    const token = signJWT({ userId: user.id });
    setAuthCookie(res, token);
    log.info('auth.signup', { userId: user.id });
    return res.json({ user: publicUser(user) });
  } catch (err) {
    log.error('auth.signup.error', { err: String(err) });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ---------- SIGNIN ----------
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    const emailLower = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { emailLower } });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = signJWT({ userId: user.id });
    setAuthCookie(res, token);
    log.info('auth.signin', { userId: user.id });
    return res.json({ user: publicUser(user) });
  } catch (err) {
    log.error('auth.signin.error', { err: String(err) });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ---------- SIGNOUT ----------
router.post('/signout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ---------- ME ----------
router.get('/me', async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  res.json({ user: user ? publicUser(user) : null });
});

// ---------- VERIFY EMAIL ----------
router.post('/verify-email', async (req, res) => {
  const { token } = req.body || {};
  if (typeof token !== 'string' || token.length < 16) {
    return res.status(400).json({ error: 'Invalid token' });
  }
  const user = await prisma.user.findUnique({ where: { emailVerifyToken: token } });
  if (!user) return res.status(400).json({ error: 'Invalid or expired token' });
  if (user.emailVerifyExpires && user.emailVerifyExpires < new Date()) {
    return res.status(400).json({ error: 'Token expired' });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, emailVerifyToken: null, emailVerifyExpires: null },
  });
  log.info('auth.email_verified', { userId: user.id });
  res.json({ ok: true });
});

// ---------- RESEND VERIFICATION ----------
router.post('/resend-verification', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.emailVerified) return res.json({ ok: true, already: true });
  const verifyToken = generateRandomToken(24);
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifyToken: verifyToken, emailVerifyExpires: expiresIn(24 * 60 * 60 * 1000) },
  });
  sendVerificationEmail(user.email, user.displayName, verifyToken).catch(() => {});
  res.json({ ok: true });
});

// ---------- REQUEST PASSWORD RESET ----------
router.post('/request-reset', async (req, res) => {
  const { email } = req.body || {};
  // Always respond 200 so we don't leak which emails are registered
  res.json({ ok: true });
  if (!isValidEmail(email)) return;
  const emailLower = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { emailLower } });
  if (!user) return;
  const resetToken = generateRandomToken(24);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetToken: resetToken, passwordResetExpires: expiresIn(60 * 60 * 1000) },
  });
  sendPasswordResetEmail(user.email, user.displayName, resetToken).catch(() => {});
});

// ---------- DO PASSWORD RESET ----------
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || token.length < 16) return res.status(400).json({ error: 'Invalid token' });
  if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be 8+ characters' });
  const user = await prisma.user.findUnique({ where: { passwordResetToken: token } });
  if (!user) return res.status(400).json({ error: 'Invalid or expired token' });
  if (user.passwordResetExpires && user.passwordResetExpires < new Date()) {
    return res.status(400).json({ error: 'Token expired' });
  }
  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, passwordResetToken: null, passwordResetExpires: null },
  });
  log.info('auth.password_reset', { userId: user.id });
  const jwtToken = signJWT({ userId: user.id });
  setAuthCookie(res, jwtToken);
  res.json({ ok: true, user: publicUser(user) });
});

// ---------- UPDATE PROFILE ----------
router.patch('/me', requireAuth, async (req, res) => {
  const { displayName } = req.body || {};
  const updates = {};
  if (displayName !== undefined) {
    if (!isValidName(displayName)) return res.status(400).json({ error: 'Invalid display name' });
    updates.displayName = displayName.trim();
  }
  if (Object.keys(updates).length === 0) return res.json({ user: null });
  const user = await prisma.user.update({ where: { id: req.user.id }, data: updates });
  res.json({ user: publicUser(user) });
});

// ---------- USER STATS / HISTORY ----------
router.get('/me/history', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
  // Find all rooms the user played in, joining their seats and other seats
  const seats = await prisma.seat.findMany({
    where: { userId: req.user.id, room: { status: 'finished' } },
    include: {
      room: {
        include: { seats: { select: { id: true, name: true, score: true, userId: true } } },
      },
    },
    orderBy: { joinedAt: 'desc' },
    take: limit,
  });
  const history = seats.map((s) => {
    const room = s.room;
    const myScore = s.score;
    const winnerSeat = room.seats.reduce((a, b) => (a.score > b.score ? a : b));
    return {
      roomId: room.id,
      finishedAt: room.finishedAt,
      myScore,
      iWon: winnerSeat.id === s.id,
      opponents: room.seats.filter((x) => x.id !== s.id).map((x) => ({ name: x.name, score: x.score })),
      mode: room.mode,
    };
  });
  res.json({ history });
});

export default router;