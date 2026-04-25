import { prisma } from '../db.js';
import { log } from '../logger.js';

/**
 * Friendship state machine:
 *   user A → "sends request" → friendship row { userId: A, friendId: B, status: pending }
 *   user B can accept → status = accepted (one row represents the relationship)
 *   user B can decline → row deleted
 *   either side can unfriend (Phase 7+) → row deleted
 *
 * For symmetric "are A and B friends?" lookups, we accept rows in either direction
 * once accepted.
 */

export const friendsService = {
  /**
   * Search users by name or email prefix. Excludes self and existing friends/pending.
   */
  async search(currentUserId, query) {
    if (!query || query.length < 2) return [];
    const term = query.trim().toLowerCase();
    const users = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: currentUserId } },
          {
            OR: [
              { displayName: { contains: term, mode: 'insensitive' } },
              { emailLower: { contains: term } },
            ],
          },
        ],
      },
      select: { id: true, displayName: true, avatarUrl: true, rating: true },
      take: 10,
    });
    // Annotate relationship status
    const ids = users.map((u) => u.id);
    if (ids.length === 0) return [];
    const existing = await prisma.friendship.findMany({
      where: {
        OR: [
          { userId: currentUserId, friendId: { in: ids } },
          { friendId: currentUserId, userId: { in: ids } },
        ],
      },
    });
    const byOther = new Map();
    for (const f of existing) {
      const otherId = f.userId === currentUserId ? f.friendId : f.userId;
      // Direction matters: "they sent us a request" vs "we sent them"
      const sentByMe = f.userId === currentUserId;
      byOther.set(otherId, { status: f.status, sentByMe });
    }
    return users.map((u) => ({
      ...u,
      relationship: byOther.get(u.id) || null,
    }));
  },

  async sendRequest(fromUserId, toUserId) {
    if (fromUserId === toUserId) return { error: 'Cannot friend yourself' };

    const [me, them] = await Promise.all([
      prisma.user.findUnique({ where: { id: fromUserId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, displayName: true } }),
    ]);
    if (!them) return { error: 'User not found' };

    // Already a relationship in either direction?
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { userId: fromUserId, friendId: toUserId },
          { userId: toUserId, friendId: fromUserId },
        ],
      },
    });
    if (existing) {
      if (existing.status === 'accepted') return { error: 'Already friends' };
      if (existing.userId === fromUserId) return { error: 'Request already sent' };
      // They sent us one — auto-accept their request instead of creating a duplicate
      const accepted = await prisma.friendship.update({
        where: { id: existing.id },
        data: { status: 'accepted', acceptedAt: new Date() },
      });
      return { friendship: accepted, autoAccepted: true };
    }

    const friendship = await prisma.friendship.create({
      data: { userId: fromUserId, friendId: toUserId, status: 'pending' },
    });
    log.info('friend.request.sent', { fromUserId, toUserId });
    return { friendship };
  },

  async respond(currentUserId, friendshipId, accept) {
    const f = await prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!f) return { error: 'Request not found' };
    if (f.friendId !== currentUserId) return { error: 'Not your request to respond to' };
    if (f.status !== 'pending') return { error: 'Request no longer pending' };

    if (accept) {
      const updated = await prisma.friendship.update({
        where: { id: f.id },
        data: { status: 'accepted', acceptedAt: new Date() },
      });
      log.info('friend.request.accepted', { friendshipId });
      return { friendship: updated };
    } else {
      await prisma.friendship.delete({ where: { id: f.id } });
      log.info('friend.request.declined', { friendshipId });
      return { declined: true, otherUserId: f.userId };
    }
  },

  async unfriend(currentUserId, otherUserId) {
    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { userId: currentUserId, friendId: otherUserId, status: 'accepted' },
          { userId: otherUserId, friendId: currentUserId, status: 'accepted' },
        ],
      },
    });
    return { ok: true };
  },

  /**
   * Get all friends + pending requests for a user.
   */
  async listFor(userId) {
    const rows = await prisma.friendship.findMany({
      where: {
        OR: [{ userId }, { friendId: userId }],
      },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true, rating: true } },
        friend: { select: { id: true, displayName: true, avatarUrl: true, rating: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const friends = [];
    const incoming = [];   // requests sent TO me
    const outgoing = [];   // requests sent BY me

    for (const r of rows) {
      const iAmRequester = r.userId === userId;
      const other = iAmRequester ? r.friend : r.user;
      const entry = {
        friendshipId: r.id,
        userId: other.id,
        displayName: other.displayName,
        avatarUrl: other.avatarUrl,
        rating: other.rating,
      };
      if (r.status === 'accepted') friends.push(entry);
      else if (r.status === 'pending') {
        if (iAmRequester) outgoing.push(entry);
        else incoming.push(entry);
      }
    }
    return { friends, incoming, outgoing };
  },

  /**
   * For a given user, return userIds of all accepted friends.
   * Used to compute online presence efficiently.
   */
  async friendIdsOf(userId) {
    const rows = await prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ userId }, { friendId: userId }],
      },
      select: { userId: true, friendId: true },
    });
    return rows.map((r) => (r.userId === userId ? r.friendId : r.userId));
  },
};