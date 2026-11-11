import os from 'os';
import { User, Post, Comment, Report, AuditLog, Session, Friendship, Reaction } from '../models/index.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { cursorPage, clampLimit } from '../utils/pagination.js';
import { escapeRegex } from '../utils/text.js';
import { loadViewablePost } from './visibility.js';
import { revokeAllSessions } from './authService.js';
import { deletePost } from './postService.js';
import { deleteComment } from './commentService.js';
import { dbState } from '../config/db.js';
import { cache } from '../config/cache.js';
import { disconnectUser } from '../sockets/realtime.js';
import { USER_CARD } from './presenter.js';

export const audit = (actor, action, targetType, target, meta = {}, ip = '') =>
  AuditLog.create({ actor: actor?._id || actor, action, targetType, target, meta, ip }).catch(() => {});

// ------------------------------------------------------------------ user-facing reporting
export async function createReport(me, { targetType, target, category, details }) {
  let targetOwner;
  if (targetType === 'user') {
    if (String(target) === String(me._id)) throw badRequest("You can't report yourself");
    const u = await User.findById(target).select('_id').lean();
    if (!u) throw notFound('User not found');
    targetOwner = u._id;
  } else if (targetType === 'post') {
    const { post } = await loadViewablePost(me._id, target, { lean: true });
    targetOwner = post.author;
  } else {
    const comment = await Comment.findById(target).lean();
    if (!comment) throw notFound('Comment not found');
    await loadViewablePost(me._id, comment.post, { lean: true });
    targetOwner = comment.author;
  }
  const existing = await Report.findOne({ reporter: me._id, targetType, target, status: 'open' }).lean();
  if (existing) return { reported: true, duplicate: true };
  await Report.create({ reporter: me._id, targetType, target, targetOwner, category, details });
  return { reported: true };
}

// ------------------------------------------------------------------ admin dashboard
export async function dashboardStats() {
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const [users, active, fresh, posts, comments, reports, friendships, reactions, sessions, banned] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ lastSeenAt: { $gte: weekAgo } }),
    User.countDocuments({ createdAt: { $gte: weekAgo } }),
    Post.countDocuments(),
    Comment.countDocuments(),
    Report.countDocuments({ status: 'open' }),
    Friendship.countDocuments(),
    Reaction.countDocuments(),
    Session.countDocuments({ revokedAt: null, rotatedAt: null, expiresAt: { $gt: new Date() } }),
    User.countDocuments({ status: { $in: ['suspended', 'banned'] } }),
  ]);
  return {
    totals: { users, activeUsers: active, newUsers: fresh, posts, comments, openReports: reports, friendships, reactions, liveSessions: sessions, restrictedUsers: banned },
    health: {
      database: dbState(),
      cache: cache.kind,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      load: os.loadavg()[0].toFixed(2),
      node: process.version,
    },
  };
}

export async function listUsers({ q, status, role, cursor, limit }) {
  const filter = {};
  if (status) filter.status = status;
  if (role) filter.role = role;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ username: rx }, { email: rx }, { name: rx }];
  }
  const { items, nextCursor } = await cursorPage(User, filter, { cursor, limit, select: 'username email name avatar role status emailVerified verifiedBadge createdAt lastSeenAt' });
  return { items, nextCursor };
}

export async function moderateUser(actor, userId, { action, role, reason }, ip) {
  const target = await User.findById(userId);
  if (!target) throw notFound('User not found');
  if (String(target._id) === String(actor._id)) throw badRequest('You cannot moderate your own account');
  if (target.role === 'admin' && actor.role !== 'admin') throw forbidden('Only admins can moderate admins');

  switch (action) {
    case 'suspend':
    case 'ban':
      target.status = action === 'ban' ? 'banned' : 'suspended';
      await target.save();
      await Post.updateMany({ author: target._id }, { $set: { authorActive: false } });
      await revokeAllSessions(target._id);
      disconnectUser(target._id);
      break;
    case 'reinstate':
      target.status = 'active';
      await target.save();
      await Post.updateMany({ author: target._id }, { $set: { authorActive: true } });
      break;
    case 'verify':
      target.verifiedBadge = true;
      await target.save();
      break;
    case 'unverify':
      target.verifiedBadge = false;
      await target.save();
      break;
    case 'set_role':
      if (actor.role !== 'admin') throw forbidden('Only admins can change roles');
      target.role = role;
      await target.save();
      break;
    default:
      throw badRequest('Unknown action');
  }
  await audit(actor, `user.${action}`, 'user', target._id, { reason, role }, ip);
  return { _id: target._id, status: target.status, role: target.role, verifiedBadge: target.verifiedBadge };
}

// ------------------------------------------------------------------ report queue
export async function listReports({ status = 'open', cursor, limit }) {
  const { items, nextCursor } = await cursorPage(Report, status === 'all' ? {} : { status }, { cursor, limit });
  const userIds = items.flatMap((r) => [r.reporter, r.targetOwner]).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } }).select(USER_CARD).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const rows = await Promise.all(
    items.map(async (r) => {
      let preview = null;
      if (r.targetType === 'post') preview = await Post.findById(r.target).select('text media type').lean();
      if (r.targetType === 'comment') preview = await Comment.findById(r.target).select('text').lean();
      if (r.targetType === 'user') preview = byId.get(String(r.target)) || (await User.findById(r.target).select(USER_CARD).lean());
      return { ...r, reporter: byId.get(String(r.reporter)) || null, targetOwner: byId.get(String(r.targetOwner)) || null, preview };
    })
  );
  return { items: rows, nextCursor };
}

export async function resolveReport(actor, reportId, { status, removeContent, note }, ip) {
  const report = await Report.findById(reportId);
  if (!report) throw notFound('Report not found');
  if (removeContent) {
    if (report.targetType === 'post') await deletePost(actor, report.target).catch(() => {});
    if (report.targetType === 'comment') await deleteComment(actor, report.target).catch(() => {});
  }
  report.status = status;
  report.resolvedBy = actor._id;
  report.resolutionNote = note || '';
  await report.save();
  await audit(actor, `report.${status}`, report.targetType, report.target, { reportId: String(report._id), removeContent: !!removeContent }, ip);
  return report;
}

export async function listAuditLogs({ cursor, limit }) {
  const { items, nextCursor } = await cursorPage(AuditLog, {}, { cursor, limit: clampLimit(limit, 25) });
  const users = await User.find({ _id: { $in: items.map((i) => i.actor).filter(Boolean) } }).select(USER_CARD).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return { items: items.map((i) => ({ ...i, actor: i.actor ? byId.get(String(i.actor)) || null : null })), nextCursor };
}
