import { prisma } from '../db.js';
import { GAME_INVITE_TTL_MS } from '../events.js';
import { log } from '../logger.js';

export const invitesService = {
  async create(fromUserId, toUserId, roomId) {
    // Drop any older pending invites from this user to this user for any room
    await prisma.gameInvite.deleteMany({
      where: { fromUserId, toUserId, status: 'pending' },
    });
    const invite = await prisma.gameInvite.create({
      data: {
        fromUserId,
        toUserId,
        roomId,
        expiresAt: new Date(Date.now() + GAME_INVITE_TTL_MS),
      },
    });
    log.info('invite.create', { inviteId: invite.id, fromUserId, toUserId, roomId });
    return invite;
  },

  async respond(currentUserId, inviteId, accept) {
    const inv = await prisma.gameInvite.findUnique({ where: { id: inviteId } });
    if (!inv) return { error: 'Invite not found' };
    if (inv.toUserId !== currentUserId) return { error: 'Not your invite' };
    if (inv.status !== 'pending') return { error: 'Invite already responded' };
    if (inv.expiresAt < new Date()) {
      await prisma.gameInvite.update({ where: { id: inv.id }, data: { status: 'expired' } });
      return { error: 'Invite expired' };
    }
    const status = accept ? 'accepted' : 'declined';
    const updated = await prisma.gameInvite.update({
      where: { id: inv.id },
      data: { status },
    });
    return { invite: updated };
  },

  async listIncoming(userId) {
    return prisma.gameInvite.findMany({
      where: {
        toUserId: userId,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      include: {
        // Get sender info
      },
      orderBy: { createdAt: 'desc' },
    }).then(async (invites) => {
      // Hydrate sender info (cleaner than nested include for our schema)
      const senderIds = [...new Set(invites.map((i) => i.fromUserId))];
      const senders = await prisma.user.findMany({
        where: { id: { in: senderIds } },
        select: { id: true, displayName: true, avatarUrl: true, rating: true },
      });
      const byId = new Map(senders.map((s) => [s.id, s]));
      return invites.map((i) => ({
        ...i,
        fromUser: byId.get(i.fromUserId) || null,
      }));
    });
  },

  async sweep() {
    const result = await prisma.gameInvite.updateMany({
      where: { status: 'pending', expiresAt: { lt: new Date() } },
      data: { status: 'expired' },
    });
    return result.count;
  },
};