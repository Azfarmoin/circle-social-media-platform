import { User, Post, Hashtag } from '../models/index.js';
import { escapeRegex } from '../utils/text.js';
import { clampLimit, cursorPage } from '../utils/pagination.js';
import { getRelations } from './relationService.js';
import { withVisibility } from './visibility.js';
import { presentPosts } from './presenter.js';
import { CARD } from './friendService.js';

export async function searchPeople(me, q, { limit = 10 } = {}) {
  const rel = await getRelations(me._id);
  const safe = escapeRegex(q.trim().toLowerCase());
  const lim = clampLimit(limit);
  const users = await User.find({
    status: 'active',
    _id: { $nin: [...rel.hiddenFromIds] },
    $or: [{ username: new RegExp(`^${safe}`) }, { name: new RegExp(`(^|\\s)${safe}`, 'i') }],
  })
    .select(`${CARD} friendCount`)
    .limit(lim * 3)
    .lean();

  // friends and people you follow first, then exact username matches, then alphabetical
  const score = (u) => (rel.friendSet.has(String(u._id)) ? 0 : rel.followingSet.has(String(u._id)) ? 1 : 2) * 10 + (u.username === q.toLowerCase() ? 0 : 5);
  return users
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))
    .slice(0, lim)
    .map((u) => ({ ...u, isFriend: rel.friendSet.has(String(u._id)), isMe: String(u._id) === String(me._id) }));
}

export async function searchPosts(me, q, { cursor, limit }) {
  const rel = await getRelations(me._id);
  const filter = withVisibility(me._id, rel, { text: new RegExp(escapeRegex(q.trim()), 'i'), _id: { $nin: me.hiddenPosts || [] } });
  const { items, nextCursor } = await cursorPage(Post, filter, { cursor, limit });
  return { items: await presentPosts(me._id, items), nextCursor };
}

export async function searchHashtags(q, { limit = 10 } = {}) {
  const tag = q.replace(/^#/, '').toLowerCase();
  return Hashtag.find({ tag: new RegExp(`^${escapeRegex(tag)}`), postCount: { $gt: 0 } }).sort({ postCount: -1 }).limit(clampLimit(limit)).select('tag postCount').lean();
}

export const trendingHashtags = (limit = 10) => Hashtag.find({ postCount: { $gt: 0 } }).sort({ postCount: -1, lastUsedAt: -1 }).limit(clampLimit(limit)).select('tag postCount').lean();

export async function suggest(me, q) {
  const [people, hashtags] = await Promise.all([searchPeople(me, q, { limit: 5 }), searchHashtags(q, { limit: 3 })]);
  return { people, hashtags };
}

// ------------------------------------------------------------------ recent searches
export async function addRecent(me, term) {
  const cleaned = term.trim().slice(0, 80);
  if (!cleaned) return me.recentSearches;
  me.recentSearches = [cleaned, ...(me.recentSearches || []).filter((t) => t.toLowerCase() !== cleaned.toLowerCase())].slice(0, 10);
  await me.save();
  return me.recentSearches;
}

export async function clearRecent(me, term) {
  me.recentSearches = term ? (me.recentSearches || []).filter((t) => t !== term) : [];
  await me.save();
  return me.recentSearches;
}
