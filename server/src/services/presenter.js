// Turns raw documents into API payloads. Each function batches its lookups so a page of 10 posts
// costs a fixed handful of queries instead of N+1.
import { User, Post, Reaction, SavedItem, PollVote } from '../models/index.js';
import { REACTIONS } from '../../../shared/constants.js';

export const USER_CARD = 'username name avatar verifiedBadge';

const idStr = (v) => String(v);

export async function userMap(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(idStr))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select(USER_CARD).lean();
  return new Map(users.map((u) => [idStr(u._id), u]));
}

export const emptyCounts = () => Object.fromEntries(REACTIONS.map((r) => [r, 0]));

const counts = (c = {}) => ({ ...emptyCounts(), ...c });

export async function presentPosts(viewerId, posts, { nested = true } = {}) {
  if (!posts.length) return [];
  const postIds = posts.map((p) => p._id);

  const sharedIds = nested ? posts.map((p) => p.sharedPost).filter(Boolean) : [];
  const shared = sharedIds.length ? await Post.find({ _id: { $in: sharedIds }, authorActive: true }).lean() : [];

  const people = await userMap([...posts.map((p) => p.author), ...posts.flatMap((p) => p.tags || []), ...shared.map((s) => s.author)]);

  const [reactions, saved, votes] = await Promise.all([
    Reaction.find({ user: viewerId, targetType: 'post', target: { $in: postIds } }).select('target type').lean(),
    SavedItem.find({ user: viewerId, post: { $in: postIds } }).select('post').lean(),
    PollVote.find({ user: viewerId, post: { $in: postIds } }).select('post options').lean(),
  ]);
  const myReaction = new Map(reactions.map((r) => [idStr(r.target), r.type]));
  const savedSet = new Set(saved.map((s) => idStr(s.post)));
  const myVotes = new Map(votes.map((v) => [idStr(v.post), v.options.map(idStr)]));
  const sharedById = new Map(shared.map((s) => [idStr(s._id), s]));

  return posts.map((p) => {
    const out = {
      _id: p._id,
      type: p.type,
      text: p.text,
      media: p.media || [],
      audience: p.audience,
      location: p.location || '',
      feeling: p.feeling?.label ? p.feeling : null,
      hashtags: p.hashtags || [],
      pinned: !!p.pinned,
      author: people.get(idStr(p.author)) || null,
      tags: (p.tags || []).map((t) => people.get(idStr(t))).filter(Boolean),
      reactionCounts: counts(p.reactionCounts),
      reactionTotal: p.reactionTotal || 0,
      commentCount: p.commentCount || 0,
      shareCount: p.shareCount || 0,
      myReaction: myReaction.get(idStr(p._id)) || null,
      saved: savedSet.has(idStr(p._id)),
      createdAt: p.createdAt,
      editedAt: p.editedAt || null,
    };
    if (p.audience === 'specific' || p.audience === 'friends_except') out.audienceCount = (p.audienceList || []).length;

    if (p.type === 'poll' && p.poll?.options) {
      const mine = myVotes.get(idStr(p._id)) || [];
      const ended = p.poll.endsAt && new Date(p.poll.endsAt) < new Date();
      out.poll = {
        question: p.poll.question,
        multiple: !!p.poll.multiple,
        endsAt: p.poll.endsAt || null,
        ended: !!ended,
        totalVotes: p.poll.totalVotes || 0,
        myVote: mine,
        options: p.poll.options.map((o) => ({ _id: o._id, text: o.text, count: p.poll.counts?.[idStr(o._id)] || 0 })),
      };
    }

    if (nested && p.sharedPost) {
      const orig = sharedById.get(idStr(p.sharedPost));
      out.sharedPost = orig
        ? { _id: orig._id, text: orig.text, media: orig.media || [], author: people.get(idStr(orig.author)) || null, createdAt: orig.createdAt, audience: orig.audience }
        : { unavailable: true, _id: p.sharedPost };
    }
    return out;
  });
}

export async function presentComments(viewerId, comments) {
  if (!comments.length) return [];
  const ids = comments.map((c) => c._id);
  const people = await userMap([...comments.map((c) => c.author), ...comments.map((c) => c.replyTo)]);
  const mine = await Reaction.find({ user: viewerId, targetType: 'comment', target: { $in: ids } }).select('target type').lean();
  const myMap = new Map(mine.map((r) => [idStr(r.target), r.type]));
  return comments.map((c) => ({
    _id: c._id,
    post: c.post,
    parent: c.parent || null,
    text: c.text,
    author: people.get(idStr(c.author)) || null,
    replyTo: c.replyTo ? people.get(idStr(c.replyTo)) || null : null,
    pinned: !!c.pinned,
    reactionCounts: counts(c.reactionCounts),
    reactionTotal: c.reactionTotal || 0,
    replyCount: c.replyCount || 0,
    myReaction: myMap.get(idStr(c._id)) || null,
    createdAt: c.createdAt,
    editedAt: c.editedAt || null,
  }));
}
