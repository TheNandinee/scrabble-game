import { log } from '../logger.js';

/**
 * Tracks online users in memory. A user is considered "online" if they have
 * at least one connected socket. Used to display green dots in the friends list
 * and to deliver real-time invites.
 */
class Presence {
  constructor() {
    this.userToSockets = new Map(); // userId -> Set<socketId>
    this.socketToUser = new Map();  // socketId -> userId
  }

  add(userId, socketId) {
    if (!userId || !socketId) return false;
    let set = this.userToSockets.get(userId);
    const wasOnline = !!set && set.size > 0;
    if (!set) {
      set = new Set();
      this.userToSockets.set(userId, set);
    }
    set.add(socketId);
    this.socketToUser.set(socketId, userId);
    return !wasOnline;  // returns true if user just came online
  }

  remove(socketId) {
    const userId = this.socketToUser.get(socketId);
    if (!userId) return null;
    this.socketToUser.delete(socketId);
    const set = this.userToSockets.get(userId);
    if (set) {
      set.delete(socketId);
      if (set.size === 0) {
        this.userToSockets.delete(userId);
        return { userId, justWentOffline: true };
      }
    }
    return { userId, justWentOffline: false };
  }

  isOnline(userId) {
    const set = this.userToSockets.get(userId);
    return !!set && set.size > 0;
  }

  socketsFor(userId) {
    return Array.from(this.userToSockets.get(userId) || []);
  }

  online() {
    return this.userToSockets.size;
  }
}

export const presence = new Presence();

if (process.env.NODE_ENV !== 'production') {
  setInterval(() => {
    log.debug('presence.snapshot', { online: presence.online() });
  }, 60_000);
}