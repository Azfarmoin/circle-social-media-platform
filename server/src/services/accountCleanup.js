import {
  User, Profile, Session, LoginEvent, Post, Friendship, FriendRequest, Follow, Block,
  Comment, Reaction, PollVote, Notification, SavedItem, Hashtag, AuditLog, Conversation, Message,
} from '../models/index.js';
import { removeUploads } from './uploadService.js';
import { invalidateRelations } from './relationService.js';

// Removes a post and everything hanging off it. Shared by post deletion and account deletion.
export async function purgePosts(posts) {
  if (!posts.length) return;
  const ids = posts.map((p) => p._id);

  const comments = await Comment.find({ post: { $in: ids } }).select('_id').lean();
  const commentIds = comments.map((c) => c._id);

  await Promise.all([
    Comment.deleteMany({ post: { $in: ids } }),
    Reaction.deleteMany({ targetType: 'post', target: { $in: ids } }),
    commentIds.length ? Reaction.deleteMany({ targetType: 'comment', target: { $in: commentIds } }) : null,
    SavedItem.deleteMany({ post: { $in: ids } }),
    PollVote.deleteMany({ post: { $in: ids } }),
    Notification.deleteMany({ post: { $in: ids } }),
  ]);

  const tagCounts = new Map();
  const mediaUrls = [];
  const sharedCounts = new Map();
  for (const p of posts) {
    (p.hashtags || []).forEach((t) => tagCounts.set(t, (tagCounts.get(t) || 0) + 1));
    (p.media || []).forEach((m) => mediaUrls.push(m.url));
    if (p.sharedPost) sharedCounts.set(String(p.sharedPost), (sharedCounts.get(String(p.sharedPost)) || 0) + 1);
  }
  await Promise.all([
    ...[...tagCounts].map(([tag, n]) => Hashtag.updateOne({ tag }, { $inc: { postCount: -n } })),
    ...[...sharedCounts].map(([id, n]) => Post.updateOne({ _id: id }, { $inc: { shareCount: -n } })),
  ]);
  await Post.deleteMany({ _id: { $in: ids } });
  await removeUploads(mediaUrls);
}

async function removeCommentsBy(userId) {
  const mine = await Comment.find({ author: userId }).lean();
  const handled = new Set();
  for (const c of mine) {
    if (handled.has(String(c._id))) continue;
    if (!c.parent) {
      const replies = await Comment.find({ parent: c._id }).select('_id').lean();
      const replyIds = replies.map((r) => r._id);
      replyIds.forEach((id) => handled.add(String(id)));
      await Reaction.deleteMany({ targetType: 'comment', target: { $in: [c._id, ...replyIds] } });
      await Comment.deleteMany({ _id: { $in: [c._id, ...replyIds] } });
      await Post.updateOne({ _id: c.post }, { $inc: { commentCount: -(1 + replyIds.length) } });
    } else {
      await Reaction.deleteMany({ targetType: 'comment', target: c._id });
      await Comment.deleteOne({ _id: c._id });
      await Comment.updateOne({ _id: c.parent }, { $inc: { replyCount: -1 } });
      await Post.updateOne({ _id: c.post }, { $inc: { commentCount: -1 } });
    }
    handled.add(String(c._id));
  }
}

async function removeReactionsBy(userId) {
  const cursor = Reaction.find({ user: userId }).lean().cursor();
  for await (const r of cursor) {
    const model = r.targetType === 'post' ? Post : Comment;
    await model.updateOne({ _id: r.target }, { $inc: { [`reactionCounts.${r.type}`]: -1, reactionTotal: -1 } });
  }
  await Reaction.deleteMany({ user: userId });
}

async function removeVotesBy(userId) {
  const votes = await PollVote.find({ user: userId }).lean();
  for (const v of votes) {
    const inc = { 'poll.totalVotes': -1 };
    v.options.forEach((id) => { inc[`poll.counts.${id}`] = -1; });
    await Post.updateOne({ _id: v.post }, { $inc: inc });
  }
  await PollVote.deleteMany({ user: userId });
}

export async function deleteAccountData(userId) {
  const [friendships, follows, followers] = await Promise.all([
    Friendship.find({ $or: [{ a: userId }, { b: userId }] }).lean(),
    Follow.find({ follower: userId }).lean(),
    Follow.find({ following: userId }).lean(),
  ]);
  const friendIds = friendships.map((f) => (String(f.a) === String(userId) ? f.b : f.a));

  await removeCommentsBy(userId);
  await removeReactionsBy(userId);
  await removeVotesBy(userId);
  await purgePosts(await Post.find({ author: userId }).lean());

  // keep the other side's counters honest
  await Promise.all([
    friendIds.length ? User.updateMany({ _id: { $in: friendIds } }, { $inc: { friendCount: -1 } }) : null,
    follows.length ? User.updateMany({ _id: { $in: follows.map((f) => f.following) } }, { $inc: { followerCount: -1 } }) : null,
    followers.length ? User.updateMany({ _id: { $in: followers.map((f) => f.follower) } }, { $inc: { followingCount: -1 } }) : null,
  ]);

  const convs = await Conversation.find({ $or: [{ a: userId }, { b: userId }] }).select('_id').lean();
  if (convs.length) {
    const imgs = await Message.find({ conversation: { $in: convs.map((c) => c._id) }, sender: userId, image: { $ne: null } }).select('image').lean();
    await removeUploads(imgs.map((m) => m.image));
    await Message.deleteMany({ conversation: { $in: convs.map((c) => c._id) } });
    await Conversation.deleteMany({ _id: { $in: convs.map((c) => c._id) } });
  }

  const user = await User.findById(userId).select('avatar cover').lean();
  await Promise.all([
    Friendship.deleteMany({ $or: [{ a: userId }, { b: userId }] }),
    FriendRequest.deleteMany({ $or: [{ from: userId }, { to: userId }] }),
    Follow.deleteMany({ $or: [{ follower: userId }, { following: userId }] }),
    Block.deleteMany({ $or: [{ user: userId }, { target: userId }] }),
    Notification.deleteMany({ $or: [{ recipient: userId }, { actor: userId }] }),
    SavedItem.deleteMany({ user: userId }),
    Session.deleteMany({ user: userId }),
    LoginEvent.deleteMany({ user: userId }),
    Profile.deleteOne({ user: userId }),
    AuditLog.create({ action: 'account.deleted', targetType: 'user', target: userId }),
  ]);
  await removeUploads([user?.avatar, user?.cover]);
  await User.deleteOne({ _id: userId });
  await invalidateRelations(userId, ...friendIds, ...follows.map((f) => f.following), ...followers.map((f) => f.follower));
}
