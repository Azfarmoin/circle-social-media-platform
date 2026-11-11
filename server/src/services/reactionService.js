import { Comment, Post, Reaction, User } from '../models/index.js';
import { REACTIONS } from '../../../shared/constants.js';
import { notFound } from '../utils/AppError.js';
import { cursorPage } from '../utils/pagination.js';
import { loadViewablePost } from './visibility.js';
import { isBlockedEitherWay } from './relationService.js';
import { emptyCounts, USER_CARD } from './presenter.js';
import { notify } from './notificationService.js';
import { emitToPost } from '../sockets/realtime.js';

// Resolves a reaction target to {model, doc, postId}, enforcing that the viewer may see the post.
async function resolveTarget(me, targetType, targetId) {
  if (targetType === 'post') {
    const { post, rel } = await loadViewablePost(me._id, targetId, { lean: true });
    return { model: Post, doc: post, postId: post._id, rel };
  }
  const comment = await Comment.findById(targetId).lean();
  if (!comment) throw notFound('Comment not found');
  const { rel } = await loadViewablePost(me._id, comment.post, { lean: true });
  return { model: Comment, doc: comment, postId: comment.post, rel };
}

const summary = (doc) => ({ reactionCounts: { ...emptyCounts(), ...(doc.reactionCounts || {}) }, reactionTotal: doc.reactionTotal || 0 });

export async function setReaction(me, targetType, targetId, type) {
  const { model, doc, postId, rel } = await resolveTarget(me, targetType, targetId);
  if (isBlockedEitherWay(rel, doc.author)) throw notFound('Not found');

  // atomic upsert: `new:false` hands back the previous reaction (or null) so counters stay exact
  const previous = await Reaction.findOneAndUpdate(
    { user: me._id, targetType, target: targetId },
    { $set: { type } },
    { upsert: true, new: false }
  );

  if (!previous) {
    await model.updateOne({ _id: targetId }, { $inc: { [`reactionCounts.${type}`]: 1, reactionTotal: 1 } });
  } else if (previous.type !== type) {
    await model.updateOne({ _id: targetId }, { $inc: { [`reactionCounts.${previous.type}`]: -1, [`reactionCounts.${type}`]: 1 } });
  } else {
    return { myReaction: type, ...summary(doc) };
  }

  const fresh = await model.findById(targetId).select('reactionCounts reactionTotal').lean();
  emitToPost(postId, 'reaction:update', { postId: String(postId), targetType, targetId: String(targetId), ...summary(fresh), actorId: String(me._id), type });
  await notify({ recipient: doc.author, actor: me._id, type: 'reaction', post: postId, comment: targetType === 'comment' ? targetId : undefined, meta: { reaction: type, targetType }, dedupe: true }).catch(() => {});
  return { myReaction: type, ...summary(fresh) };
}

export async function removeReaction(me, targetType, targetId) {
  const { model, doc, postId } = await resolveTarget(me, targetType, targetId);
  const previous = await Reaction.findOneAndDelete({ user: me._id, targetType, target: targetId });
  if (!previous) return { myReaction: null, ...summary(doc) };
  await model.updateOne({ _id: targetId }, { $inc: { [`reactionCounts.${previous.type}`]: -1, reactionTotal: -1 } });
  const fresh = await model.findById(targetId).select('reactionCounts reactionTotal').lean();
  emitToPost(postId, 'reaction:update', { postId: String(postId), targetType, targetId: String(targetId), ...summary(fresh), actorId: String(me._id), type: null });
  return { myReaction: null, ...summary(fresh) };
}

export async function listReactions(me, targetType, targetId, { type, cursor, limit }) {
  const { doc } = await resolveTarget(me, targetType, targetId);
  const filter = { targetType, target: targetId };
  if (type) filter.type = type;
  const { items, nextCursor } = await cursorPage(Reaction, filter, { cursor, limit });
  const users = await User.find({ _id: { $in: items.map((r) => r.user) } }).select(USER_CARD).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return {
    breakdown: summary(doc),
    items: items.map((r) => ({ type: r.type, user: byId.get(String(r.user)) })).filter((r) => r.user),
    nextCursor,
  };
}

export { REACTIONS };
