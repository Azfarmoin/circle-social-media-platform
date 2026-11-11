import { Comment, Post, Profile, Reaction, User } from '../models/index.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { cursorPage, clampLimit } from '../utils/pagination.js';
import { extractMentions } from '../utils/text.js';
import { loadViewablePost } from './visibility.js';
import { isBlockedEitherWay } from './relationService.js';
import { presentComments } from './presenter.js';
import { notify } from './notificationService.js';
import { emitToPost } from '../sockets/realtime.js';

async function assertCanComment(me, post, rel) {
  if (String(post.author) === String(me._id)) return;
  const profile = await Profile.findOne({ user: post.author }).select('privacy.whoCanComment').lean();
  const who = profile?.privacy?.whoCanComment || 'everyone';
  if (who === 'nobody') throw forbidden('Comments are turned off for this post', 'COMMENTS_DISABLED');
  if (who === 'friends' && !rel.friendSet.has(String(post.author))) throw forbidden('Only friends can comment on this post', 'COMMENTS_FRIENDS_ONLY');
}

const broadcast = (postId, event, payload) => emitToPost(postId, event, { postId: String(postId), ...payload });

export async function listComments(me, postId, { cursor, limit, sort = 'top' }) {
  await loadViewablePost(me._id, postId, { lean: true });
  const lim = clampLimit(limit);
  const base = { post: postId, parent: null };
  let pinnedRows = [];

  if (!cursor) {
    pinnedRows = await Comment.find({ ...base, pinned: true }).limit(1).lean();
  }
  const filter = { ...base, pinned: { $ne: true } };

  let items;
  let nextCursor = null;
  if (sort === 'top') {
    // "top" orders by engagement, so it pages by offset rather than by _id.
    const offset = cursor ? Math.max(0, parseInt(Buffer.from(cursor, 'base64url').toString(), 10) || 0) : 0;
    const rows = await Comment.find(filter).sort({ reactionTotal: -1, replyCount: -1, _id: -1 }).skip(offset).limit(lim + 1).lean();
    items = rows.slice(0, lim);
    if (rows.length > lim) nextCursor = Buffer.from(String(offset + lim)).toString('base64url');
  } else {
    const res = await cursorPage(Comment, filter, { cursor, limit: lim, sort: sort === 'oldest' ? 1 : -1 });
    items = res.items;
    nextCursor = res.nextCursor;
  }
  const total = await Comment.countDocuments(base);
  return { items: await presentComments(me._id, [...pinnedRows, ...items]), nextCursor, total };
}

export async function listReplies(me, commentId, { cursor, limit }) {
  const parent = await Comment.findById(commentId).lean();
  if (!parent) throw notFound('Comment not found');
  await loadViewablePost(me._id, parent.post, { lean: true });
  const { items, nextCursor } = await cursorPage(Comment, { parent: commentId }, { cursor, limit, sort: 1 });
  return { items: await presentComments(me._id, items), nextCursor };
}

export async function createComment(me, postId, { text, parentId }) {
  const { post, rel } = await loadViewablePost(me._id, postId);
  await assertCanComment(me, post, rel);

  let parent = null;
  let replyTo = null;
  if (parentId) {
    parent = await Comment.findOne({ _id: parentId, post: postId });
    if (!parent) throw notFound('The comment you are replying to no longer exists');
    replyTo = parent.author;
    // replies are one level deep: replying to a reply attaches to the same thread
    if (parent.parent) parent = await Comment.findById(parent.parent);
    if (!parent) throw notFound('The comment you are replying to no longer exists');
    if (isBlockedEitherWay(rel, replyTo)) throw forbidden('You cannot reply to this comment');
  }

  const names = extractMentions(text, 10);
  const mentioned = names.length ? await User.find({ username: { $in: names }, status: 'active' }).select('_id').lean() : [];
  const mentions = mentioned.map((u) => u._id).filter((id) => !isBlockedEitherWay(rel, id));

  const comment = await Comment.create({ post: postId, author: me._id, parent: parent?._id || null, replyTo: replyTo || undefined, text, mentions });
  await Post.updateOne({ _id: postId }, { $inc: { commentCount: 1 } });
  if (parent) await Comment.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 } });

  const [presented] = await presentComments(me._id, [comment.toObject()]);
  const fresh = await Post.findById(postId).select('commentCount').lean();
  broadcast(postId, 'comment:new', { comment: presented, commentCount: fresh.commentCount });

  const notified = new Set([String(me._id)]);
  const send = async (recipient, type) => {
    if (!recipient || notified.has(String(recipient))) return;
    notified.add(String(recipient));
    await notify({ recipient, actor: me._id, type, post: postId, comment: comment._id, meta: { excerpt: text.slice(0, 80) } }).catch(() => {});
  };
  if (parent) await send(replyTo, 'reply');
  for (const id of mentions) await send(id, 'mention');
  await send(post.author, 'comment');

  return { comment: presented, commentCount: fresh.commentCount };
}

export async function editComment(me, commentId, text) {
  const comment = await Comment.findOne({ _id: commentId, author: me._id });
  if (!comment) throw notFound('Comment not found');
  await loadViewablePost(me._id, comment.post, { lean: true });
  comment.text = text;
  comment.editedAt = new Date();
  await comment.save();
  const [presented] = await presentComments(me._id, [comment.toObject()]);
  broadcast(comment.post, 'comment:update', { comment: presented });
  return presented;
}

export async function deleteComment(me, commentId) {
  const comment = await Comment.findById(commentId);
  if (!comment) throw notFound('Comment not found');
  const post = await Post.findById(comment.post).select('author').lean();
  const allowed = String(comment.author) === String(me._id) || (post && String(post.author) === String(me._id)) || ['moderator', 'admin'].includes(me.role);
  if (!allowed) throw forbidden('You cannot delete this comment');

  let removed = 1;
  if (!comment.parent) {
    const replies = await Comment.find({ parent: comment._id }).select('_id').lean();
    removed += replies.length;
    const ids = [comment._id, ...replies.map((r) => r._id)];
    await Reaction.deleteMany({ targetType: 'comment', target: { $in: ids } });
    await Comment.deleteMany({ _id: { $in: ids } });
  } else {
    await Reaction.deleteMany({ targetType: 'comment', target: comment._id });
    await Comment.deleteOne({ _id: comment._id });
    await Comment.updateOne({ _id: comment.parent }, { $inc: { replyCount: -1 } });
  }
  await Post.updateOne({ _id: comment.post }, { $inc: { commentCount: -removed } });
  const fresh = await Post.findById(comment.post).select('commentCount').lean();
  broadcast(comment.post, 'comment:delete', { commentId: String(comment._id), parent: comment.parent ? String(comment.parent) : null, commentCount: fresh?.commentCount ?? 0 });
  return { commentCount: fresh?.commentCount ?? 0 };
}

export async function setCommentPinned(me, commentId, pinned) {
  const comment = await Comment.findById(commentId);
  if (!comment) throw notFound('Comment not found');
  if (comment.parent) throw badRequest('Only top-level comments can be pinned');
  const post = await Post.findOne({ _id: comment.post, author: me._id }).select('_id').lean();
  if (!post) throw forbidden('Only the post author can pin comments');
  if (pinned) await Comment.updateMany({ post: comment.post, pinned: true }, { $set: { pinned: false } });
  comment.pinned = pinned;
  await comment.save();
  broadcast(comment.post, 'comment:pin', { commentId: String(comment._id), pinned });
  return { pinned };
}
