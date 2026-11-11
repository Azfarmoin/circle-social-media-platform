// Loads (and briefly caches) everything the visibility rules need to know about a viewer's
// social graph: friends, followed users, and block lists in both directions.
import { Friendship, Follow, Block } from '../models/index.js';
import { cache } from '../config/cache.js';

const key = (id) => `rel:${id}`;
const TTL = 30;

export async function getRelations(userId) {
  const id = String(userId);
  const hit = await cache.get(key(id));
  if (hit) return hydrate(hit);

  const [friendships, follows, blocks, blockedBy] = await Promise.all([
    Friendship.find({ $or: [{ a: userId }, { b: userId }] }).select('a b').lean(),
    Follow.find({ follower: userId }).select('following').lean(),
    Block.find({ user: userId }).select('target type').lean(),
    Block.find({ target: userId, type: 'block' }).select('user').lean(),
  ]);

  const raw = {
    friendIds: friendships.map((f) => String(f.a) === id ? String(f.b) : String(f.a)),
    followingIds: follows.map((f) => String(f.following)),
    blocked: blocks.filter((b) => b.type === 'block').map((b) => String(b.target)),
    restricted: blocks.filter((b) => b.type === 'restrict').map((b) => String(b.target)),
    blockedBy: blockedBy.map((b) => String(b.user)),
  };
  await cache.set(key(id), raw, TTL);
  return hydrate(raw);
}

function hydrate(raw) {
  return {
    ...raw,
    friendSet: new Set(raw.friendIds),
    followingSet: new Set(raw.followingIds),
    blockedSet: new Set(raw.blocked),
    blockedBySet: new Set(raw.blockedBy),
    restrictedSet: new Set(raw.restricted),
    // anyone the viewer must never see content from, or be seen by
    hiddenFromIds: [...new Set([...raw.blocked, ...raw.blockedBy])],
  };
}

export const invalidateRelations = (...ids) => cache.del(ids.flat().map((i) => key(i)));

export const isBlockedEitherWay = (rel, otherId) => rel.blockedSet.has(String(otherId)) || rel.blockedBySet.has(String(otherId));
