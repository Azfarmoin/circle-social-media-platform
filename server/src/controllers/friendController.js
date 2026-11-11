import { Profile } from '../models/index.js';
import * as friends from '../services/friendService.js';
import { getRelations, isBlockedEitherWay } from '../services/relationService.js';
import { notFound } from '../utils/AppError.js';

// Friend / follower lists of another user obey their "who can see my friends" privacy setting.
async function assertListVisible(viewer, userId) {
  if (String(viewer._id) === String(userId)) return true;
  const rel = await getRelations(viewer._id);
  if (isBlockedEitherWay(rel, userId)) throw notFound('User not found');
  const profile = await Profile.findOne({ user: userId }).select('privacy.friendListVisibility').lean();
  const vis = profile?.privacy?.friendListVisibility || 'everyone';
  return vis === 'everyone' || (vis === 'friends' && rel.friendSet.has(String(userId)));
}

export const sendRequest = async (req, res) => res.status(201).json(await friends.sendRequest(req.user, req.params.id));
export const accept = async (req, res) => { await friends.acceptRequest(req.user, req.params.id); res.json({ status: 'friends' }); };
export const reject = async (req, res) => { await friends.rejectRequest(req.user, req.params.id); res.json({ status: 'rejected' }); };
export const cancel = async (req, res) => { await friends.cancelRequest(req.user, req.params.id); res.json({ status: 'cancelled' }); };
export const remove = async (req, res) => { await friends.removeFriend(req.user, req.params.id); res.json({ status: 'removed' }); };

export const requests = async (req, res) => res.json(await friends.listRequests(req.user, req.query));
export const myFriends = async (req, res) => res.json(await friends.listFriends(req.user._id, req.query));
export const userFriends = async (req, res) => {
  if (!(await assertListVisible(req.user, req.params.id))) return res.json({ items: [], nextCursor: null, restricted: true });
  res.json(await friends.listFriends(req.params.id, req.query));
};
export const mutual = async (req, res) => res.json(await friends.mutualFriends(req.user, req.params.id));
export const suggestions = async (req, res) => res.json({ items: await friends.suggestions(req.user, Number(req.query.limit) || 10) });

export const follow = async (req, res) => res.json(await friends.follow(req.user, req.params.id));
export const unfollow = async (req, res) => res.json(await friends.unfollow(req.user, req.params.id));
export const followers = async (req, res) => {
  if (!(await assertListVisible(req.user, req.params.id))) return res.json({ items: [], nextCursor: null, restricted: true });
  res.json(await friends.listFollowers(req.params.id, req.query));
};
export const following = async (req, res) => {
  if (!(await assertListVisible(req.user, req.params.id))) return res.json({ items: [], nextCursor: null, restricted: true });
  res.json(await friends.listFollowing(req.params.id, req.query));
};
