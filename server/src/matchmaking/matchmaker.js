import { prisma } from '../db.js';
import {
  QUEUE_TICK_MS, QUEUE_RATING_INITIAL, QUEUE_RATING_GROWTH, QUEUE_RATING_MAX,
} from '../events.js';
import { log } from '../logger.js';

/**
 * Matchmaker loop.
 *
 * Strategy: every QUEUE_TICK_MS we look at all queue entries and group them by
 * desiredSize. Within a group, we sort by rating. We then walk the list and
 * try to form clusters where every pair's rating difference is within a window.
 * The window starts at QUEUE_RATING_INITIAL and grows over time per entry,
 * so freshly enqueued players are matched tightly while long-waiting players
 * gradually open up.
 *
 * When a cluster of `desiredSize` is found, we delete those queue rows and
 * fire onMatch(userIds, desiredSize), which the socket layer uses to create
 * a room and notify both clients.
 */
export class Matchmaker {
  constructor({ onMatch }) {
    this.onMatch = onMatch;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((err) =>
      log.error('matchmaker.tick.error', { err: String(err) })
    ), QUEUE_TICK_MS);
    log.info('matchmaker.start');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async enqueue(userId, socketId, rating, desiredSize) {
    // Upsert: leaving + rejoining queue replaces old entry
    return prisma.queueEntry.upsert({
      where: { userId },
      update: { socketId, rating, desiredSize, enqueuedAt: new Date() },
      create: { userId, socketId, rating, desiredSize },
    });
  }

  async dequeue(userId) {
    await prisma.queueEntry.deleteMany({ where: { userId } });
  }

  async dequeueBySocket(socketId) {
    await prisma.queueEntry.deleteMany({ where: { socketId } });
  }

  async queueCount(desiredSize) {
    return prisma.queueEntry.count({ where: { desiredSize } });
  }

  async positionFor(userId) {
    // Approximate: count entries enqueued before ours with same desiredSize
    const entry = await prisma.queueEntry.findUnique({ where: { userId } });
    if (!entry) return null;
    const ahead = await prisma.queueEntry.count({
      where: { desiredSize: entry.desiredSize, enqueuedAt: { lt: entry.enqueuedAt } },
    });
    return { position: ahead + 1, desiredSize: entry.desiredSize, enqueuedAt: entry.enqueuedAt };
  }

  async tick() {
    const entries = await prisma.queueEntry.findMany({
      orderBy: { enqueuedAt: 'asc' },
    });
    if (entries.length === 0) return;

    // Group by desiredSize
    const bySize = new Map();
    for (const e of entries) {
      if (!bySize.has(e.desiredSize)) bySize.set(e.desiredSize, []);
      bySize.get(e.desiredSize).push(e);
    }

    const matched = [];

    for (const [size, group] of bySize.entries()) {
      // Sort by rating to make sliding-window matching easier
      group.sort((a, b) => a.rating - b.rating);
      const used = new Set();

      for (let i = 0; i < group.length; i++) {
        if (used.has(group[i].id)) continue;
        const seed = group[i];
        const windowMs = Date.now() - seed.enqueuedAt.getTime();
        const ticksWaited = Math.floor(windowMs / QUEUE_TICK_MS);
        const window = Math.min(
          QUEUE_RATING_INITIAL + ticksWaited * QUEUE_RATING_GROWTH,
          QUEUE_RATING_MAX
        );

        // Find others within rating window of seed (and within window of each other transitively)
        const cluster = [seed];
        for (let j = i + 1; j < group.length && cluster.length < size; j++) {
          if (used.has(group[j].id)) continue;
          // Check against highest in cluster (since group is sorted ascending)
          const high = cluster[cluster.length - 1];
          if (group[j].rating - high.rating <= window) {
            cluster.push(group[j]);
          } else {
            break; // too far; stop looking
          }
        }

        if (cluster.length === size) {
          for (const c of cluster) used.add(c.id);
          matched.push({ size, entries: cluster });
        }
      }
    }

    if (matched.length === 0) return;

    // Persist: delete matched queue rows, then notify the socket layer
    for (const m of matched) {
      const ids = m.entries.map((e) => e.id);
      await prisma.queueEntry.deleteMany({ where: { id: { in: ids } } });
      log.info('matchmaker.matched', {
        size: m.size,
        userIds: m.entries.map((e) => e.userId),
        ratings: m.entries.map((e) => e.rating),
      });
      try {
        await this.onMatch(
          m.entries.map((e) => ({ userId: e.userId, socketId: e.socketId })),
          m.size
        );
      } catch (err) {
        log.error('matchmaker.onMatch.error', { err: String(err) });
      }
    }
  }
}