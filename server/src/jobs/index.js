// Lightweight in-process scheduler. For horizontal scale, run these from a single worker
// process or swap in BullMQ (Redis) without changing the job bodies.
import { Session, User, Notification, LoginEvent } from '../models/index.js';
import { logger } from '../config/logger.js';

const DAY = 86400000;

export async function cleanupExpired() {
  const now = new Date();
  const [sessions, verify, reset, notifs, events] = await Promise.all([
    Session.deleteMany({ expiresAt: { $lt: new Date(now - 7 * DAY) } }),
    User.updateMany({ verifyTokenExpires: { $lt: now } }, { $unset: { verifyTokenHash: '', verifyTokenExpires: '' } }),
    User.updateMany({ resetTokenExpires: { $lt: now } }, { $unset: { resetTokenHash: '', resetTokenExpires: '' } }),
    Notification.deleteMany({ read: true, createdAt: { $lt: new Date(now - 90 * DAY) } }),
    LoginEvent.deleteMany({ createdAt: { $lt: new Date(now - 180 * DAY) } }),
  ]);
  const summary = { sessions: sessions.deletedCount, verifyTokens: verify.modifiedCount, resetTokens: reset.modifiedCount, notifications: notifs.deletedCount, loginEvents: events.deletedCount };
  logger.info(summary, 'cleanup job finished');
  return summary;
}

export function startJobs() {
  const timers = [setInterval(() => cleanupExpired().catch((e) => logger.error({ err: e }, 'cleanup failed')), 6 * 3600 * 1000)];
  timers.forEach((t) => t.unref());
  setTimeout(() => cleanupExpired().catch(() => {}), 15000).unref();
  return () => timers.forEach(clearInterval);
}
