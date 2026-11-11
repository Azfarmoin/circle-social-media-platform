import { User, Profile, FriendRequest, Friendship, Follow, Block, pairOf } from '../models/index.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError.js';
import { cursorPage, clampLimit } from '../utils/pagination.js';
import { getRelations, invalidateRelations, isBlockedEitherWay } from './relationService.js';
import { notify } from './notificationService.js';

export const CARD = 'username name avatar bio verifiedBadge';

const loadTarget = async (targetId) => {
  const user = await User.findOne({ _id: targetId, status: 'active' }).select(`${CARD} friendCount followerCount`);
  if (!user) throw notFound('User not found');
  return user;
};

// ------------------------------------------------------------------ friend requests
export async function sendRequest(me, targetId) {
  if (String(me._id) === String(targetId)) throw badRequest("You can't send a request to yourself");
  const target = await loadTarget(targetId);
  const rel = await getRelations(me._id);
  if (isBlockedEitherWay(rel, targetId)) throw notFound('User not found');
  if (rel.friendSet.has(String(targetId))) throw conflict('You are already friends', 'ALREADY_FRIENDS');

  const profile = await Profile.findOne({ user: targetId }).select('privacy.whoCanSendFriendRequests').lean();
  if (profile?.privacy?.whoCanSendFriendRequests === 'nobody') throw forbidden('This person is not accepting friend requests', 'REQUESTS_DISABLED');

  // If they already asked me, sending a request simply accepts theirs.
  const reverse = await FriendRequest.findOne({ from: targetId, to: me._id, status: 'pending' });
  if (reverse) return { status: 'friends', friendship: await acceptRequest(me, reverse._id) };

  const request = await FriendRequest.findOneAndUpdate(
    { from: me._id, to: targetId },
    { $set: { status: 'pending' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await notify({ recipient: targetId, actor: me._id, type: 'friend_request', meta: { requestId: String(request._id) }, dedupe: true });
  return { status: 'request_sent', requestId: request._id, target: target.toObject() };
}

export async function acceptRequest(me, requestId) {
  const request = await FriendRequest.findOneAndUpdate({ _id: requestId, to: me._id, status: 'pending' }, { $set: { status: 'accepted' } }, { new: true });
  if (!request) throw notFound('Friend request not found');
  const pair = pairOf(request.from, request.to);
  try {
    await Friendship.create(pair);
  } catch (err) {
    if (err.code !== 11000) throw err; // already friends: fine
    return pair;
  }
  // Friends automatically follow each other. Each user document gets exactly one $inc so the
  // counters stay correct no matter how the database orders concurrent writes.
  const fromFollows = await ensureFollow(request.from, request.to);
  const toFollows = await ensureFollow(request.to, request.from);
  await Promise.all([
    applyCounts(request.from, { friendCount: 1, followingCount: fromFollows, followerCount: toFollows }),
    applyCounts(request.to, { friendCount: 1, followingCount: toFollows, followerCount: fromFollows }),
  ]);
  await invalidateRelations(request.from, request.to);
  await notify({ recipient: request.from, actor: me._id, type: 'friend_accept', dedupe: true });
  return pair;
}

// returns 1 when a new follow edge was created, 0 when it already existed
async function ensureFollow(follower, following) {
  const res = await Follow.updateOne({ follower, following }, { $setOnInsert: { follower, following } }, { upsert: true });
  return res.upsertedCount ? 1 : 0;
}

const applyCounts = (userId, deltas) => {
  const inc = Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== 0).map(([k, v]) => [k, v]));
  return Object.keys(inc).length ? User.updateOne({ _id: userId }, { $inc: inc }) : null;
};

export async function rejectRequest(me, requestId) {
  const r = await FriendRequest.findOneAndUpdate({ _id: requestId, to: me._id, status: 'pending' }, { $set: { status: 'rejected' } });
  if (!r) throw notFound('Friend request not found');
}

export async function cancelRequest(me, requestId) {
  const r = await FriendRequest.findOneAndUpdate({ _id: requestId, from: me._id, status: 'pending' }, { $set: { status: 'cancelled' } });
  if (!r) throw notFound('Friend request not found');
}

export async function removeFriend(me, friendId) {
  const res = await Friendship.deleteOne(pairOf(me._id, friendId));
  if (!res.deletedCount) throw notFound('You are not friends with this person');
  await dropFollows(me._id, friendId, { friendCount: -1 });
  await FriendRequest.deleteMany({ $or: [{ from: me._id, to: friendId }, { from: friendId, to: me._id }] });
  await invalidateRelations(me._id, friendId);
}

// Removes follow edges in both directions and applies one combined counter update per user.
// `extra` adds additional deltas to both users (e.g. friendCount when unfriending).
async function dropFollows(x, y, extra = {}) {
  const [xy, yx] = [
    (await Follow.deleteOne({ follower: x, following: y })).deletedCount,
    (await Follow.deleteOne({ follower: y, following: x })).deletedCount,
  ];
  await Promise.all([
    applyCounts(x, { ...extra, followingCount: -xy, followerCount: -yx }),
    applyCounts(y, { ...extra, followingCount: -yx, followerCount: -xy }),
  ]);
}

export async function listRequests(me, { direction = 'incoming', cursor, limit }) {
  const filter = direction === 'incoming' ? { to: me._id, status: 'pending' } : { from: me._id, status: 'pending' };
  const { items, nextCursor } = await cursorPage(FriendRequest, filter, { cursor, limit });
  const otherIds = items.map((r) => (direction === 'incoming' ? r.from : r.to));
  const users = await User.find({ _id: { $in: otherIds }, status: 'active' }).select(CARD).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const rows = items.map((r) => ({ _id: r._id, createdAt: r.createdAt, user: byId.get(String(direction === 'incoming' ? r.from : r.to)) })).filter((r) => r.user);
  return { items: rows, nextCursor };
}

// ------------------------------------------------------------------ lists
export async function listFriends(userId, { cursor, limit }) {
  const { items, nextCursor } = await cursorPage(Friendship, { $or: [{ a: userId }, { b: userId }] }, { cursor, limit });
  const ids = items.map((f) => (String(f.a) === String(userId) ? f.b : f.a));
  const users = await User.find({ _id: { $in: ids }, status: 'active' }).select(CARD).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return { items: ids.map((id) => byId.get(String(id))).filter(Boolean), nextCursor };
}

export async function mutualFriends(me, otherId, { limit = 20 } = {}) {
  const [mine, theirs] = await Promise.all([getRelations(me._id), getRelations(otherId)]);
  const ids = mine.friendIds.filter((id) => theirs.friendSet.has(id)).slice(0, clampLimit(limit, 20));
  const users = await User.find({ _id: { $in: ids }, status: 'active' }).select(CARD).lean();
  return { items: users, total: mine.friendIds.filter((id) => theirs.friendSet.has(id)).length };
}

export async function listFollowers(userId, { cursor, limit }) {
  const { items, nextCursor } = await cursorPage(Follow, { following: userId }, { cursor, limit });
  const users = await User.find({ _id: { $in: items.map((i) => i.follower) }, status: 'active' }).select(CARD).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return { items: items.map((i) => byId.get(String(i.follower))).filter(Boolean), nextCursor };
}

export async function listFollowing(userId, { cursor, limit }) {
  const { items, nextCursor } = await cursorPage(Follow, { follower: userId }, { cursor, limit });
  const users = await User.find({ _id: { $in: items.map((i) => i.following) }, status: 'active' }).select(CARD).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return { items: items.map((i) => byId.get(String(i.following))).filter(Boolean), nextCursor };
}

// ------------------------------------------------------------------ follow
export async function follow(me, targetId) {
  if (String(me._id) === String(targetId)) throw badRequest("You can't follow yourself");
  await loadTarget(targetId);
  const rel = await getRelations(me._id);
  if (isBlockedEitherWay(rel, targetId)) throw notFound('User not found');
  const profile = await Profile.findOne({ user: targetId }).select('privacy.whoCanFollow').lean();
  if (profile?.privacy?.whoCanFollow === 'nobody' && !rel.friendSet.has(String(targetId))) throw forbidden('This person does not allow new followers', 'FOLLOW_DISABLED');

  const res = await Follow.updateOne({ follower: me._id, following: targetId }, { $setOnInsert: { follower: me._id, following: targetId } }, { upsert: true });
  if (res.upsertedCount) {
    await Promise.all([User.updateOne({ _id: me._id }, { $inc: { followingCount: 1 } }), User.updateOne({ _id: targetId }, { $inc: { followerCount: 1 } })]);
    await notify({ recipient: targetId, actor: me._id, type: 'follow', dedupe: true });
  }
  await invalidateRelations(me._id);
  return { following: true };
}

export async function unfollow(me, targetId) {
  const res = await Follow.deleteOne({ follower: me._id, following: targetId });
  if (res.deletedCount) {
    await Promise.all([User.updateOne({ _id: me._id }, { $inc: { followingCount: -1 } }), User.updateOne({ _id: targetId }, { $inc: { followerCount: -1 } })]);
  }
  await invalidateRelations(me._id);
  return { following: false };
}

// ------------------------------------------------------------------ suggestions
export async function suggestions(me, limit = 10) {
  const rel = await getRelations(me._id);
  const pending = await FriendRequest.find({ $or: [{ from: me._id }, { to: me._id }], status: 'pending' }).select('from to').lean();
  const exclude = new Set([String(me._id), ...rel.friendIds, ...rel.hiddenFromIds, ...rel.restricted]);
  pending.forEach((p) => { exclude.add(String(p.from)); exclude.add(String(p.to)); });

  // friends-of-friends, ranked by number of mutual friends
  const scores = new Map();
  const friends = rel.friendIds.slice(0, 60);
  if (friends.length) {
    const edges = await Friendship.find({ $or: [{ a: { $in: friends } }, { b: { $in: friends } }] }).select('a b').limit(2000).lean();
    for (const e of edges) {
      const a = String(e.a);
      const b = String(e.b);
      const other = rel.friendSet.has(a) ? b : a;
      if (exclude.has(other)) continue;
      scores.set(other, (scores.get(other) || 0) + 1);
    }
  }
  const ranked = [...scores].sort((x, y) => y[1] - x[1]).slice(0, limit);
  const results = [];
  if (ranked.length) {
    const users = await User.find({ _id: { $in: ranked.map(([id]) => id) }, status: 'active' }).select(CARD).lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    ranked.forEach(([id, n]) => byId.has(id) && results.push({ ...byId.get(id), mutualCount: n }));
  }

  if (results.length < limit) {
    const have = new Set([...exclude, ...results.map((r) => String(r._id))]);
    const fill = await User.find({ _id: { $nin: [...have] }, status: 'active', emailVerified: true }).sort({ _id: -1 }).limit(limit - results.length).select(CARD).lean();
    fill.forEach((u) => results.push({ ...u, mutualCount: 0 }));
  }
  return results;
}

// ------------------------------------------------------------------ block / restrict
export async function setBlock(me, targetId, type = 'block') {
  if (String(me._id) === String(targetId)) throw badRequest("You can't do that to yourself");
  await loadTarget(targetId);
  await Block.updateOne({ user: me._id, target: targetId, type }, { $setOnInsert: { user: me._id, target: targetId, type } }, { upsert: true });
  if (type === 'block') {
    // blocking severs every tie between the two accounts
    if (await Friendship.exists(pairOf(me._id, targetId))) await removeFriend(me, targetId).catch(() => {});
    await dropFollows(me._id, targetId);
    await FriendRequest.deleteMany({ $or: [{ from: me._id, to: targetId }, { from: targetId, to: me._id }] });
  }
  await invalidateRelations(me._id, targetId);
}

export async function removeBlock(me, targetId, type = 'block') {
  await Block.deleteOne({ user: me._id, target: targetId, type });
  await invalidateRelations(me._id, targetId);
}

export async function listBlocked(me, type = 'block') {
  const rows = await Block.find({ user: me._id, type }).sort({ _id: -1 }).limit(200).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.target) } }).select(CARD).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return rows.map((r) => byId.get(String(r.target))).filter(Boolean);
}

// ------------------------------------------------------------------ relationship summary for profile pages
export async function relationshipWith(me, otherId) {
  if (String(me._id) === String(otherId)) return { isMe: true };
  const [rel, outgoing, incoming] = await Promise.all([
    getRelations(me._id),
    FriendRequest.findOne({ from: me._id, to: otherId, status: 'pending' }).select('_id').lean(),
    FriendRequest.findOne({ from: otherId, to: me._id, status: 'pending' }).select('_id').lean(),
  ]);
  const id = String(otherId);
  return {
    isMe: false,
    friendship: rel.friendSet.has(id) ? 'friends' : outgoing ? 'request_sent' : incoming ? 'request_received' : 'none',
    requestId: outgoing?._id || incoming?._id || null,
    following: rel.followingSet.has(id),
    blocked: rel.blockedSet.has(id),
    blockedBy: rel.blockedBySet.has(id),
    restricted: rel.restrictedSet.has(id),
  };
}
