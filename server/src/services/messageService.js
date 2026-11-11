import { Conversation, Message, Profile, User, pairKey } from '../models/index.js';
import { pairOf } from '../models/Relationships.js';
import { getRelations, isBlockedEitherWay } from './relationService.js';
import { emitToUser, isOnline } from '../sockets/realtime.js';
import { saveImage, removeUploads } from './uploadService.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { clampLimit, decodeCursor, encodeCursor } from '../utils/pagination.js';
import { USER_CARD } from './presenter.js';

const isA = (conv, userId) => String(conv.a) === String(userId);
const otherId = (conv, userId) => (isA(conv, userId) ? conv.b : conv.a);
const unreadFor = (conv, userId) => (isA(conv, userId) ? conv.unreadA : conv.unreadB);

/** Can `sender` start or continue a chat with `recipientId`? Throws a friendly error when not. */
export async function assertCanMessage(sender, recipientId) {
  if (String(sender._id) === String(recipientId)) throw badRequest('You cannot message yourself');
  const recipient = await User.findById(recipientId).select(USER_CARD + ' status').lean();
  if (!recipient || recipient.status !== 'active') throw notFound('User not found');
  const rel = await getRelations(sender._id);
  if (isBlockedEitherWay(rel, recipientId)) throw notFound('User not found');
  const profile = await Profile.findOne({ user: recipientId }).select('privacy.whoCanMessage').lean();
  const who = profile?.privacy?.whoCanMessage || 'everyone';
  if (who === 'nobody') throw forbidden('This person is not accepting messages', 'MESSAGES_OFF');
  if (who === 'friends' && !rel.friendSet.has(String(recipientId))) throw forbidden('Only friends can message this person', 'MESSAGES_FRIENDS_ONLY');
  return recipient;
}

async function loadConversation(userId, id) {
  const conv = await Conversation.findById(id).lean().catch(() => null);
  if (!conv || (String(conv.a) !== String(userId) && String(conv.b) !== String(userId))) throw notFound('Conversation not found');
  return conv;
}

const presentMessage = (m, viewerId) => ({
  _id: m._id,
  conversation: m.conversation,
  sender: m.sender,
  text: m.deletedAt ? '' : m.text,
  image: m.deletedAt ? null : m.image || null,
  deleted: !!m.deletedAt,
  // only the sender sees whether it was read, and only when the reader allows receipts
  readAt: String(m.sender) === String(viewerId) ? m.readAt || null : undefined,
  createdAt: m.createdAt,
});

const preview = (m) => (m.text ? m.text.slice(0, 200) : m.image ? '📷 Photo' : '');

async function onlineFlags(ids) {
  const profiles = await Profile.find({ user: { $in: ids } }).select('user privacy.showOnlineStatus').lean();
  const hidden = new Set(profiles.filter((p) => p.privacy?.showOnlineStatus === false).map((p) => String(p.user)));
  return (id) => !hidden.has(String(id)) && isOnline(id);
}

function presentConversation(conv, viewerId, other, online = false) {
  return {
    _id: conv._id,
    other: { ...other, online },
    lastMessage: conv.lastMessage?.at ? { text: conv.lastMessage.text, sender: conv.lastMessage.sender, at: conv.lastMessage.at } : null,
    unread: unreadFor(conv, viewerId),
    updatedAt: conv.updatedAt,
  };
}

export async function openConversation(viewer, userId) {
  const other = await assertCanMessage(viewer, userId);
  const { a, b } = pairOf(viewer._id, userId);
  const key = pairKey(viewer._id, userId);
  let conv = await Conversation.findOne({ pair: key }).lean();
  if (!conv) {
    try {
      conv = (await Conversation.create({ a, b, pair: key })).toObject();
    } catch (e) {
      if (e.code !== 11000) throw e;
      conv = await Conversation.findOne({ pair: key }).lean();
    }
  }
  const flag = await onlineFlags([other._id]);
  return presentConversation(conv, viewer._id, { _id: other._id, username: other.username, name: other.name, avatar: other.avatar, verifiedBadge: other.verifiedBadge }, flag(other._id));
}

export async function listConversations(viewer, { limit } = {}) {
  const rel = await getRelations(viewer._id);
  const convs = await Conversation.find({ $or: [{ a: viewer._id }, { b: viewer._id }], 'lastMessage.at': { $ne: null } })
    .sort({ 'lastMessage.at': -1 })
    .limit(clampLimit(limit, 50) + 10)
    .lean();
  const visible = convs.filter((c) => !isBlockedEitherWay(rel, otherId(c, viewer._id)));
  const users = await User.find({ _id: { $in: visible.map((c) => otherId(c, viewer._id)) }, status: 'active' }).select(USER_CARD).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const flag = await onlineFlags(users.map((u) => u._id));
  const items = visible
    .map((c) => (byId.has(String(otherId(c, viewer._id))) ? presentConversation(c, viewer._id, byId.get(String(otherId(c, viewer._id))), flag(otherId(c, viewer._id))) : null))
    .filter(Boolean)
    .slice(0, clampLimit(limit, 50));
  return { items };
}

export async function listMessages(viewer, conversationId, { cursor, limit } = {}) {
  const conv = await loadConversation(viewer._id, conversationId);
  const rel = await getRelations(viewer._id);
  if (isBlockedEitherWay(rel, otherId(conv, viewer._id))) throw notFound('Conversation not found');
  const lim = clampLimit(limit, 30);
  const filter = { conversation: conv._id };
  const after = decodeCursor(cursor);
  if (after) filter._id = { $lt: after };
  const rows = await Message.find(filter).sort({ _id: -1 }).limit(lim + 1).lean();
  const hasMore = rows.length > lim;
  const items = (hasMore ? rows.slice(0, lim) : rows).map((m) => presentMessage(m, viewer._id));
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]._id) : null };
}

export async function sendMessage(viewer, conversationId, text, file) {
  const conv = await loadConversation(viewer._id, conversationId);
  const recipientId = otherId(conv, viewer._id);
  await assertCanMessage(viewer, recipientId);

  const image = file ? await saveImage(file) : null;
  const msg = await Message.create({ conversation: conv._id, sender: viewer._id, text, image });
  const unreadField = isA(conv, viewer._id) ? 'unreadB' : 'unreadA';
  const updated = await Conversation.findByIdAndUpdate(
    conv._id,
    { $set: { lastMessage: { text: preview({ text, image }), sender: viewer._id, at: msg.createdAt } }, $inc: { [unreadField]: 1 } },
    { new: true }
  ).lean();

  const message = presentMessage(msg.toObject(), viewer._id);
  emitToUser(recipientId, 'message:new', { conversationId: String(conv._id), message: { ...message, readAt: undefined }, unread: unreadFor(updated, recipientId), from: viewer._id });
  emitToUser(viewer._id, 'message:new', { conversationId: String(conv._id), message, unread: unreadFor(updated, viewer._id), from: viewer._id });
  return message;
}

export async function markRead(viewer, conversationId) {
  const conv = await loadConversation(viewer._id, conversationId);
  const mine = isA(conv, viewer._id) ? 'unreadA' : 'unreadB';
  await Conversation.updateOne({ _id: conv._id }, { $set: { [mine]: 0 } });

  const profile = await Profile.findOne({ user: viewer._id }).select('privacy.readReceipts').lean();
  const receipts = profile?.privacy?.readReceipts !== false;
  const now = new Date();
  if (receipts) {
    await Message.updateMany({ conversation: conv._id, sender: otherId(conv, viewer._id), readAt: null }, { $set: { readAt: now } });
    emitToUser(otherId(conv, viewer._id), 'message:read', { conversationId: String(conv._id), at: now });
  }
  emitToUser(viewer._id, 'message:read:self', { conversationId: String(conv._id) });
  return { ok: true };
}

export async function unreadTotal(viewerId) {
  const rows = await Conversation.find({ $or: [{ a: viewerId }, { b: viewerId }] }).select('a b unreadA unreadB').lean();
  const rel = await getRelations(viewerId);
  return rows.filter((c) => !isBlockedEitherWay(rel, otherId(c, viewerId))).reduce((n, c) => n + unreadFor(c, viewerId), 0);
}

/** "Unsend": the sender can remove their own message for everyone. */
export async function deleteMessage(viewer, messageId) {
  const msg = await Message.findById(messageId).catch(() => null);
  if (!msg || String(msg.sender) !== String(viewer._id)) throw notFound('Message not found');
  if (msg.deletedAt) return { ok: true };
  const oldImage = msg.image;
  msg.deletedAt = new Date();
  msg.text = '';
  msg.image = null;
  await msg.save();
  if (oldImage) await removeUploads([oldImage]);
  const conv = await Conversation.findById(msg.conversation).lean();
  if (conv) {
    const last = await Message.findOne({ conversation: conv._id, deletedAt: null }).sort({ _id: -1 }).lean();
    await Conversation.updateOne({ _id: conv._id }, { $set: { lastMessage: last ? { text: preview(last), sender: last.sender, at: last.createdAt } : { text: '', at: null } } });
    const payload = { conversationId: String(conv._id), messageId: String(msg._id) };
    emitToUser(otherId(conv, viewer._id), 'message:delete', payload);
    emitToUser(viewer._id, 'message:delete', payload);
  }
  return { ok: true };
}

export async function getConversation(viewer, conversationId) {
  const conv = await loadConversation(viewer._id, conversationId);
  const rel = await getRelations(viewer._id);
  const oid = otherId(conv, viewer._id);
  if (isBlockedEitherWay(rel, oid)) throw notFound('Conversation not found');
  const other = await User.findOne({ _id: oid, status: 'active' }).select(USER_CARD).lean();
  if (!other) throw notFound('Conversation not found');
  const flag = await onlineFlags([other._id]);
  return presentConversation(conv, viewer._id, other, flag(other._id));
}

/** Tells the people you chat with that you came online or went offline (respects your privacy setting). */
export async function announcePresence(userId, online) {
  try {
    const profile = await Profile.findOne({ user: userId }).select('privacy.showOnlineStatus').lean();
    if (profile?.privacy?.showOnlineStatus === false) return;
    const convs = await Conversation.find({ $or: [{ a: userId }, { b: userId }] }).select('a b').lean();
    for (const c of convs) emitToUser(otherId(c, userId), 'presence', { userId: String(userId), online });
  } catch { /* presence is best effort */ }
}

/** Relays "is typing" to the other person in a conversation the sender belongs to. */
export async function relayTyping(userId, conversationId, typing) {
  try {
    const conv = await Conversation.findById(conversationId).select('a b').lean();
    if (!conv || (String(conv.a) !== String(userId) && String(conv.b) !== String(userId))) return;
    const to = otherId(conv, userId);
    const rel = await getRelations(userId);
    if (isBlockedEitherWay(rel, to)) return;
    emitToUser(to, 'typing', { conversationId: String(conv._id), userId: String(userId), typing: !!typing });
  } catch { /* best effort */ }
}
