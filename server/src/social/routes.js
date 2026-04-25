import express from 'express';
import { requireAuth } from '../auth/middleware.js';
import { friendsService } from './friendsService.js';
import { invitesService } from './invitesService.js';
import { presence } from './presence.js';

const router = express.Router();

router.use(requireAuth);

// ---------- friends ----------
router.get('/friends', async (req, res) => {
  const { friends, incoming, outgoing } = await friendsService.listFor(req.user.id);
  // Annotate online presence
  const annotate = (arr) => arr.map((f) => ({ ...f, online: presence.isOnline(f.userId) }));
  res.json({
    friends: annotate(friends),
    incoming: annotate(incoming),
    outgoing: annotate(outgoing),
  });
});

router.get('/friends/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const results = await friendsService.search(req.user.id, q);
  res.json({ results: results.map((u) => ({ ...u, online: presence.isOnline(u.id) })) });
});

router.post('/friends/request', async (req, res) => {
  const { userId } = req.body || {};
  if (typeof userId !== 'string') return res.status(400).json({ error: 'userId required' });
  const result = await friendsService.sendRequest(req.user.id, userId);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post('/friends/respond', async (req, res) => {
  const { friendshipId, accept } = req.body || {};
  if (typeof friendshipId !== 'string') return res.status(400).json({ error: 'friendshipId required' });
  const result = await friendsService.respond(req.user.id, friendshipId, !!accept);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post('/friends/unfriend', async (req, res) => {
  const { userId } = req.body || {};
  if (typeof userId !== 'string') return res.status(400).json({ error: 'userId required' });
  await friendsService.unfriend(req.user.id, userId);
  res.json({ ok: true });
});

// ---------- invites ----------
router.get('/invites', async (req, res) => {
  const invites = await invitesService.listIncoming(req.user.id);
  res.json({ invites });
});

// ----- The invite-create endpoint receives `io` via app.locals -----
router.post('/invites', async (req, res) => {
  const io = req.app.locals.io;
  const { toUserId, roomId } = req.body || {};
  if (typeof toUserId !== 'string' || typeof roomId !== 'string') {
    return res.status(400).json({ error: 'toUserId and roomId required' });
  }
  // Must be friends
  const friends = await friendsService.friendIdsOf(req.user.id);
  if (!friends.includes(toUserId)) {
    return res.status(403).json({ error: 'Not friends with that user' });
  }
  const invite = await invitesService.create(req.user.id, toUserId, roomId);
  // Notify recipient if online
  if (io && req.app.locals.notifyGameInvite) {
    req.app.locals.notifyGameInvite(io, invite, {
      id: req.user.id,
      displayName: req.user.displayName,
      avatarUrl: req.user.avatarUrl,
    });
  }
  res.json({ invite });
});

export default router;