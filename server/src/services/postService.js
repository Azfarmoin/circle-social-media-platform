import { Post, User, Profile, Hashtag, PollVote, SavedItem } from '../models/index.js';
import { FEELINGS, LIMITS } from '../../../shared/constants.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { cursorPage, clampLimit } from '../utils/pagination.js';
import { extractHashtags, extractMentions } from '../utils/text.js';
import { getRelations, isBlockedEitherWay } from './relationService.js';
import { withVisibility, loadViewablePost } from './visibility.js';
import { presentPosts } from './presenter.js';
import { notify } from './notificationService.js';
import { purgePosts } from './accountCleanup.js';
import { emitToPost } from '../sockets/realtime.js';

// ------------------------------------------------------------------ helpers
async function resolveMentions(text, me, rel) {
  const names = extractMentions(text, 20);
  if (!names.length) return [];
  const users = await User.find({ username: { $in: names }, status: 'active' }).select('_id').lean();
  return users.map((u) => u._id).filter((id) => !isBlockedEitherWay(rel, id));
}

async function resolveTags(tagIds = [], me, rel) {
  const unique = [...new Set(tagIds.map(String))].filter((id) => id !== String(me._id)).slice(0, 30);
  if (!unique.length) return [];
  const notFriends = unique.filter((id) => !rel.friendSet.has(id));
  if (notFriends.length) throw badRequest('You can only tag your friends', 'TAG_NOT_FRIEND');
  const profiles = await Profile.find({ user: { $in: unique } }).select('user privacy.whoCanTag').lean();
  const blocked = new Set(profiles.filter((p) => p.privacy?.whoCanTag === 'nobody').map((p) => String(p.user)));
  return unique.filter((id) => !blocked.has(id));
}

function restrictAudienceList(list = [], rel) {
  return [...new Set(list.map(String))].filter((id) => rel.friendSet.has(id)).slice(0, LIMITS.maxAudienceList);
}

// Can `userId` see a post with this audience? Evaluated from the author's point of view.
function audienceIncludes(post, userId, authorRel) {
  const id = String(userId);
  const list = (post.audienceList || []).map(String);
  switch (post.audience) {
    case 'public': return true;
    case 'friends': return authorRel.friendSet.has(id);
    case 'friends_except': return authorRel.friendSet.has(id) && !list.includes(id);
    case 'specific': return list.includes(id);
    default: return false;
  }
}

async function bumpHashtags(add = [], remove = []) {
  const now = new Date();
  await Promise.all([
    ...add.map((tag) => Hashtag.updateOne({ tag }, { $inc: { postCount: 1 }, $set: { lastUsedAt: now } }, { upsert: true })),
    ...remove.map((tag) => Hashtag.updateOne({ tag }, { $inc: { postCount: -1 } })),
  ]);
}

const stripShare = async (viewerId, sharedId) => {
  const { post: original } = await loadViewablePost(viewerId, sharedId, { lean: true });
  if (original.sharedPost) {
    // sharing a share points at the original, so chains never nest
    const { post } = await loadViewablePost(viewerId, original.sharedPost, { lean: true }).catch(() => ({ post: null }));
    if (!post) throw notFound('The original post is no longer available');
    return post;
  }
  return original;
};

// ------------------------------------------------------------------ create / edit / delete
export async function createPost(me, input, imageUrls = []) {
  const rel = await getRelations(me._id);
  const profile = await Profile.findOne({ user: me._id }).select('privacy.defaultPostAudience').lean();

  const audience = input.audience || profile?.privacy?.defaultPostAudience || 'friends';
  const audienceList = ['friends_except', 'specific'].includes(audience) ? restrictAudienceList(input.audienceList, rel) : [];
  if (audience === 'specific' && !audienceList.length) throw badRequest('Choose at least one friend for this audience', 'EMPTY_AUDIENCE');

  const text = input.text || '';
  const hasPoll = !!input.poll;
  let original = null;
  if (input.sharedPostId) {
    original = await stripShare(me._id, input.sharedPostId);
    if (original.audience !== 'public' && String(original.author) !== String(me._id)) throw forbidden('Only public posts can be shared', 'NOT_SHAREABLE');
  }
  if (!text && !imageUrls.length && !hasPoll && !original) throw badRequest('Write something or add a photo first', 'EMPTY_POST');
  if (hasPoll && imageUrls.length) throw badRequest('A poll cannot include photos', 'POLL_WITH_MEDIA');

  const tags = await resolveTags(input.tags, me, rel);
  const mentions = await resolveMentions(text, me, rel);
  const hashtags = extractHashtags(text, LIMITS.maxHashtags);
  const feeling = input.feeling ? FEELINGS.find((f) => f.label === input.feeling) : null;

  const doc = {
    author: me._id,
    type: original ? 'share' : hasPoll ? 'poll' : imageUrls.length ? 'photo' : 'text',
    text,
    media: imageUrls.map((url) => ({ url })),
    audience,
    audienceList,
    tags,
    mentions,
    hashtags,
    location: input.location || '',
    feeling: feeling || undefined,
    sharedPost: original?._id,
  };
  if (hasPoll) {
    const hours = input.poll.durationHours || 24 * 7;
    doc.poll = {
      question: input.poll.question,
      options: input.poll.options.map((t) => ({ text: t })),
      multiple: !!input.poll.multiple,
      endsAt: new Date(Date.now() + hours * 3600 * 1000),
      totalVotes: 0,
    };
  }

  const post = await Post.create(doc);
  await bumpHashtags(hashtags);

  const targets = new Map();
  tags.forEach((id) => targets.set(String(id), 'tag'));
  mentions.forEach((id) => !targets.has(String(id)) && targets.set(String(id), 'mention'));
  for (const [userId, type] of targets) {
    if (audienceIncludes(post, userId, rel)) await notify({ recipient: userId, actor: me._id, type, post: post._id }).catch(() => {});
  }
  if (original) {
    await Post.updateOne({ _id: original._id }, { $inc: { shareCount: 1 } });
    await notify({ recipient: original.author, actor: me._id, type: 'share', post: original._id }).catch(() => {});
  }
  return (await presentPosts(me._id, [post.toObject()]))[0];
}

export async function editPost(me, postId, input) {
  const post = await Post.findOne({ _id: postId, author: me._id });
  if (!post) throw notFound('Post not found');
  const rel = await getRelations(me._id);

  if (input.audience) {
    post.audience = input.audience;
    post.audienceList = ['friends_except', 'specific'].includes(input.audience) ? restrictAudienceList(input.audienceList, rel) : [];
    if (post.audience === 'specific' && !post.audienceList.length) throw badRequest('Choose at least one friend for this audience', 'EMPTY_AUDIENCE');
  }
  if (input.location !== undefined) post.location = input.location;
  if (input.feeling !== undefined) post.feeling = input.feeling ? FEELINGS.find((f) => f.label === input.feeling) : undefined;

  if (input.text !== undefined && input.text !== post.text) {
    if (!input.text && !post.media.length && !post.poll?.options && !post.sharedPost) throw badRequest('A post cannot be empty', 'EMPTY_POST');
    const before = post.hashtags;
    post.text = input.text;
    post.hashtags = extractHashtags(input.text, LIMITS.maxHashtags);
    post.mentions = await resolveMentions(input.text, me, rel);
    post.editedAt = new Date();
    await bumpHashtags(post.hashtags.filter((t) => !before.includes(t)), before.filter((t) => !post.hashtags.includes(t)));
  }
  await post.save();
  return (await presentPosts(me._id, [post.toObject()]))[0];
}

export async function deletePost(user, postId) {
  const post = await Post.findById(postId).lean();
  if (!post) throw notFound('Post not found');
  const isOwner = String(post.author) === String(user._id);
  if (!isOwner && !['moderator', 'admin'].includes(user.role)) throw forbidden('You can only delete your own posts');
  await purgePosts([post]);
  return post;
}

export async function setPinned(me, postId, pinned) {
  const post = await Post.findOne({ _id: postId, author: me._id });
  if (!post) throw notFound('Post not found');
  if (pinned) await Post.updateMany({ author: me._id, pinned: true }, { $set: { pinned: false } });
  post.pinned = pinned;
  await post.save();
  return { pinned };
}

// ------------------------------------------------------------------ viewer-specific actions
export async function getPost(viewerId, postId) {
  const { post } = await loadViewablePost(viewerId, postId, { lean: true });
  return (await presentPosts(viewerId, [post]))[0];
}

export async function savePost(me, postId, collection = 'All') {
  await loadViewablePost(me._id, postId, { lean: true });
  await SavedItem.updateOne({ user: me._id, post: postId }, { $set: { folder: collection } }, { upsert: true });
  return { saved: true };
}

export async function unsavePost(me, postId) {
  await SavedItem.deleteOne({ user: me._id, post: postId });
  return { saved: false };
}

export async function hidePost(me, postId) {
  await loadViewablePost(me._id, postId, { lean: true });
  await User.updateOne({ _id: me._id }, { $addToSet: { hiddenPosts: postId } });
  const fresh = await User.findById(me._id).select('hiddenPosts');
  if (fresh.hiddenPosts.length > LIMITS.maxHiddenPosts) {
    fresh.hiddenPosts = fresh.hiddenPosts.slice(-LIMITS.maxHiddenPosts);
    await fresh.save();
  }
  return { hidden: true };
}

export async function snoozeAuthor(me, authorId, days = 30) {
  if (String(authorId) === String(me._id)) throw badRequest("You can't snooze yourself");
  const until = new Date(Date.now() + days * 86400000);
  const kept = (me.snoozed || []).filter((s) => String(s.user) !== String(authorId) && s.until > new Date());
  me.snoozed = [...kept, { user: authorId, until }];
  await me.save();
  return { until };
}

export async function votePoll(me, postId, optionIds) {
  const { post } = await loadViewablePost(me._id, postId);
  if (post.type !== 'poll' || !post.poll?.options?.length) throw badRequest('This post has no poll');
  if (post.poll.endsAt && post.poll.endsAt < new Date()) throw badRequest('This poll has ended', 'POLL_ENDED');
  const valid = new Set(post.poll.options.map((o) => String(o._id)));
  const chosen = [...new Set(optionIds.map(String))];
  if (!chosen.length || chosen.some((id) => !valid.has(id))) throw badRequest('Invalid poll option');
  if (!post.poll.multiple && chosen.length !== 1) throw badRequest('Choose exactly one option');

  const previous = await PollVote.findOneAndUpdate({ post: postId, user: me._id }, { $set: { options: chosen } }, { upsert: true, new: false });
  const oldIds = previous ? previous.options.map(String) : [];

  const inc = {};
  oldIds.filter((x) => !chosen.includes(x)).forEach((id) => { inc[`poll.counts.${id}`] = -1; });
  chosen.filter((x) => !oldIds.includes(x)).forEach((id) => { inc[`poll.counts.${id}`] = 1; });
  if (!previous) inc['poll.totalVotes'] = 1;
  if (Object.keys(inc).length) await Post.updateOne({ _id: postId }, { $inc: inc });

  const fresh = (await presentPosts(me._id, [(await Post.findById(postId)).toObject()]))[0];
  emitToPost(postId, 'poll:update', { postId, options: fresh.poll.options, totalVotes: fresh.poll.totalVotes });
  return fresh;
}

// ------------------------------------------------------------------ lists
const hiddenIds = (me) => me.hiddenPosts || [];
const snoozedAuthors = (me) => (me.snoozed || []).filter((s) => s.until > new Date()).map((s) => String(s.user));

async function page(me, filter, opts) {
  const { items, nextCursor } = await cursorPage(Post, filter, opts);
  return { items: await presentPosts(me._id, items), nextCursor };
}

export async function getFeed(me, { cursor, limit }) {
  const rel = await getRelations(me._id);
  const snoozed = new Set(snoozedAuthors(me));
  const network = [...new Set([String(me._id), ...rel.friendIds, ...rel.followingIds])].filter((id) => !snoozed.has(id));
  const filter = withVisibility(me._id, rel, { author: { $in: network }, _id: { $nin: hiddenIds(me) } });
  return page(me, filter, { cursor, limit });
}

export async function getExplore(me, { cursor, limit }) {
  const rel = await getRelations(me._id);
  const filter = withVisibility(me._id, rel, { audience: 'public', _id: { $nin: hiddenIds(me) } });
  return page(me, filter, { cursor, limit });
}

// Engagement-weighted ranking over the last week of public posts, paged by numeric offset.
export async function getTrending(me, { cursor, limit }) {
  const rel = await getRelations(me._id);
  const lim = clampLimit(limit);
  const offset = cursor ? Math.max(0, parseInt(Buffer.from(cursor, 'base64url').toString(), 10) || 0) : 0;
  const since = new Date(Date.now() - 7 * 86400000);
  const filter = withVisibility(me._id, rel, { audience: 'public', createdAt: { $gte: since }, _id: { $nin: hiddenIds(me) } });
  const candidates = await Post.find(filter).sort({ _id: -1 }).limit(150).lean();
  const now = Date.now();
  const scored = candidates
    .map((p) => {
      const ageH = (now - new Date(p.createdAt).getTime()) / 3600000;
      const engagement = (p.reactionTotal || 0) + 2 * (p.commentCount || 0) + 3 * (p.shareCount || 0);
      return { p, score: (engagement + 1) / Math.pow(ageH + 2, 1.2) };
    })
    .sort((x, y) => y.score - x.score);
  const slice = scored.slice(offset, offset + lim).map((s) => s.p);
  const next = offset + lim < scored.length ? Buffer.from(String(offset + lim)).toString('base64url') : null;
  return { items: await presentPosts(me._id, slice), nextCursor: next };
}

async function profileGate(viewer, authorId) {
  if (String(viewer._id) === String(authorId)) return true;
  const rel = await getRelations(viewer._id);
  if (isBlockedEitherWay(rel, authorId)) return false;
  const profile = await Profile.findOne({ user: authorId }).select('privacy.profileVisibility').lean();
  const vis = profile?.privacy?.profileVisibility || 'everyone';
  return vis === 'everyone' || (vis === 'friends' && rel.friendSet.has(String(authorId)));
}

export async function getUserPosts(me, authorId, { cursor, limit, kind = 'all' }) {
  if (!(await profileGate(me, authorId))) return { items: [], nextCursor: null, restricted: true };
  const rel = await getRelations(me._id);

  const extra = kind === 'tagged' ? { tags: authorId } : { author: authorId };
  if (kind === 'photos') extra['media.0'] = { $exists: true };
  if (kind === 'all') extra.pinned = { $ne: true };
  const result = await page(me, withVisibility(me._id, rel, extra), { cursor, limit });

  if (kind === 'all' && !cursor) {
    const pinned = await Post.findOne(withVisibility(me._id, rel, { author: authorId, pinned: true })).lean();
    if (pinned) result.items = [...(await presentPosts(me._id, [pinned])), ...result.items];
  }
  return result;
}

export async function getHashtagPosts(me, tag, { cursor, limit }) {
  const rel = await getRelations(me._id);
  return page(me, withVisibility(me._id, rel, { hashtags: tag.toLowerCase(), _id: { $nin: hiddenIds(me) } }), { cursor, limit });
}

export async function getSavedPosts(me, { cursor, limit, collection }) {
  const filter = { user: me._id };
  if (collection) filter.folder = collection;
  const { items, nextCursor } = await cursorPage(SavedItem, filter, { cursor, limit });
  const rel = await getRelations(me._id);
  const posts = await Post.find(withVisibility(me._id, rel, { _id: { $in: items.map((i) => i.post) } })).lean();
  const byId = new Map(posts.map((p) => [String(p._id), p]));
  const ordered = items.map((i) => byId.get(String(i.post))).filter(Boolean);
  return { items: await presentPosts(me._id, ordered), nextCursor };
}

export async function savedCollections(me) {
  const names = await SavedItem.distinct('folder', { user: me._id });
  return names;
}

export async function postAudienceMembers(me, postId) {
  const post = await Post.findOne({ _id: postId, author: me._id }).lean();
  if (!post) throw notFound('Post not found');
  const users = await User.find({ _id: { $in: post.audienceList } }).select('username name avatar').lean();
  return users;
}
