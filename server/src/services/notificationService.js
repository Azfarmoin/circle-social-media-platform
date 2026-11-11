import { Notification, User } from '../models/index.js';
import { emitToUser } from '../sockets/realtime.js';
import { cursorPage } from '../utils/pagination.js';
import { sendMail, mailTemplates } from './mailService.js';
import { getRelations, isBlockedEitherWay } from './relationService.js';

const ACTOR_FIELDS = 'username name avatar verifiedBadge';
const PREF_KEYS = ['friend_request', 'friend_accept', 'follow', 'reaction', 'comment', 'reply', 'mention', 'tag', 'share'];

export async function notify({ recipient, actor, type, post, comment, meta = {}, dedupe = false }) {
  if (actor && String(recipient) === String(actor)) return null;

  const user = await User.findById(recipient).select('notificationPrefs email name status');
  if (!user || user.status !== 'active') return null;
  if (PREF_KEYS.includes(type) && user.notificationPrefs?.[type] === false) return null;
  if (actor) {
    const rel = await getRelations(recipient);
    if (isBlockedEitherWay(rel, actor)) return null;
  }

  let doc;
  if (dedupe) {
    // e.g. a user changing their reaction should update the existing notification, not add another
    doc = await Notification.findOneAndUpdate(
      { recipient, actor, type, post: post || null, comment: comment || null },
      { $set: { meta, read: false } },
      { upsert: true, new: true }
    );
  } else {
    doc = await Notification.create({ recipient, actor, type, post, comment, meta });
  }

  const payload = await present(doc);
  emitToUser(recipient, 'notification', payload);

  if (type === 'friend_request' && user.notificationPrefs?.emailFriendRequests && payload.actor) {
    const t = mailTemplates.friendRequest(user.name, payload.actor.name || payload.actor.username);
    sendMail({ to: user.email, ...t });
  }
  return payload;
}

async function present(doc) {
  const n = doc.toObject ? doc.toObject() : doc;
  const actor = n.actor ? await User.findById(n.actor).select(ACTOR_FIELDS).lean() : null;
  return { ...n, actor };
}

export async function presentMany(rows) {
  const ids = [...new Set(rows.map((r) => r.actor && String(r.actor)).filter(Boolean))];
  const users = await User.find({ _id: { $in: ids } }).select(ACTOR_FIELDS).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return rows.map((r) => ({ ...r, actor: r.actor ? byId.get(String(r.actor)) || null : null }));
}

export async function listNotifications(userId, { cursor, limit, unreadOnly }) {
  const filter = { recipient: userId };
  if (unreadOnly) filter.read = false;
  const { items, nextCursor } = await cursorPage(Notification, filter, { cursor, limit });
  const unread = await Notification.countDocuments({ recipient: userId, read: false });
  return { items: await presentMany(items), nextCursor, unread };
}

export const unreadCount = (userId) => Notification.countDocuments({ recipient: userId, read: false });

export async function markRead(userId, ids) {
  const filter = { recipient: userId, read: false };
  if (ids?.length) filter._id = { $in: ids };
  await Notification.updateMany(filter, { $set: { read: true } });
  return { unread: await unreadCount(userId) };
}

export async function removeNotification(userId, id) {
  await Notification.deleteOne({ _id: id, recipient: userId });
  return { unread: await unreadCount(userId) };
}

export async function updatePreferences(user, prefs) {
  for (const [k, v] of Object.entries(prefs)) user.set(`notificationPrefs.${k}`, v);
  await user.save();
  return user.notificationPrefs;
}
