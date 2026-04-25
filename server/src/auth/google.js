import express from 'express';
import { randomBytes } from 'crypto';
import { prisma } from '../db.js';
import { signJWT } from './tokens.js';
import { log } from '../logger.js';

const router = express.Router();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const isProd = process.env.NODE_ENV === 'production';
const COOKIE_NAME = 'auth_token';

const isConfigured = !!(CLIENT_ID && CLIENT_SECRET && CALLBACK_URL);

if (!isConfigured) {
  log.warn('google_oauth.disabled', { reason: 'env vars not set' });
}

router.get('/status', (_req, res) => {
  res.json({ enabled: isConfigured });
});

// Step 1: redirect to Google
router.get('/google', (req, res) => {
  if (!isConfigured) return res.status(503).send('Google OAuth not configured');

  const state = randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 5 * 60 * 1000,
    path: '/',
  });

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// Step 2: handle callback
router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.cookies?.oauth_state;
  res.clearCookie('oauth_state', { path: '/' });

  if (!code || !state || state !== expectedState) {
    return res.redirect(`${CLIENT_URL}/?auth_error=invalid_state`);
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: CALLBACK_URL,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new Error(`Google token exchange failed: ${tokenRes.status}`);
    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;

    // Fetch user profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) throw new Error(`Google userinfo failed: ${profileRes.status}`);
    const profile = await profileRes.json();

    if (!profile.email || !profile.id) {
      throw new Error('Google profile missing email or id');
    }

    const emailLower = profile.email.toLowerCase();

    // Find or create user
    let user = await prisma.user.findUnique({ where: { googleId: profile.id } });
    if (!user) {
      // Maybe they already signed up with email — link the account
      user = await prisma.user.findUnique({ where: { emailLower } });
      if (user) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId: profile.id, emailVerified: true, avatarUrl: profile.picture || user.avatarUrl },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email: profile.email,
            emailLower,
            displayName: profile.name || profile.email.split('@')[0],
            avatarUrl: profile.picture || null,
            googleId: profile.id,
            emailVerified: true,
          },
        });
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = signJWT({ userId: user.id });
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    log.info('auth.google.success', { userId: user.id });
    res.redirect(CLIENT_URL);
  } catch (err) {
    log.error('auth.google.error', { err: String(err) });
    res.redirect(`${CLIENT_URL}/?auth_error=oauth_failed`);
  }
});

export default router;