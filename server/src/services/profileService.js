import { User, Profile, Friendship, pairOf } from '../models/index.js';
import { forbidden, notFound } from '../utils/AppError.js';
import { getRelations, isBlockedEitherWay } from './relationService.js';
import { relationshipWith } from './friendService.js';
import { saveImage, removeUploads } from './uploadService.js';

const canSee = (setting, { isMe, isFriend }) => isMe || setting === 'everyone' || (setting === 'friends' && isFriend);

export async function getProfile(viewer, username) {
  const user = await User.findOne({ username: username.toLowerCase(), status: 'active' }).select('username name bio avatar cover verifiedBadge friendCount followerCount followingCount createdAt role');
  if (!user) throw notFound('Profile not found');

  const rel = await getRelations(viewer._id);
  if (isBlockedEitherWay(rel, user._id)) throw notFound('Profile not found');

  const profile = (await Profile.findOne({ user: user._id }).lean()) || { privacy: {} };
  const relationship = await relationshipWith(viewer, user._id);
  const ctx = { isMe: relationship.isMe, isFriend: relationship.friendship === 'friends' };
  const p = profile.privacy || {};

  const card = {
    _id: user._id, username: user.username, name: user.name, avatar: user.avatar, cover: user.cover, verifiedBadge: user.verifiedBadge,
  };

  if (!canSee(p.profileVisibility || 'everyone', ctx)) {
    return { user: card, restricted: true, relationship, counts: {} };
  }

  const about = canSee(p.aboutVisibility || 'everyone', ctx)
    ? {
        website: profile.website, location: profile.location, education: profile.education, work: profile.work,
        relationshipStatus: profile.relationshipStatus, languages: profile.languages,
        birthday: canSee(p.birthdayVisibility || 'friends', ctx) ? profile.birthday : undefined,
      }
    : null;

  return {
    user: { ...card, bio: user.bio, createdAt: user.createdAt },
    about,
    featuredPosts: profile.featuredPosts || [],
    relationship,
    friendsVisible: canSee(p.friendListVisibility || 'everyone', ctx),
    counts: { friends: user.friendCount, followers: user.followerCount, following: user.followingCount },
    privacy: relationship.isMe ? p : undefined,
  };
}

export async function updateProfile(user, data) {
  const { name, bio, ...extra } = data;
  if (name !== undefined) user.name = name;
  if (bio !== undefined) user.bio = bio;
  await user.save();
  const profile = await Profile.findOneAndUpdate({ user: user._id }, { $set: extra }, { upsert: true, new: true, runValidators: true });
  return { user, profile };
}

export async function updatePrivacy(user, privacy) {
  const set = {};
  for (const [k, v] of Object.entries(privacy)) set[`privacy.${k}`] = v;
  const profile = await Profile.findOneAndUpdate({ user: user._id }, { $set: set }, { upsert: true, new: true, runValidators: true });
  return profile.privacy;
}

export async function getPrivacy(user) {
  const profile = await Profile.findOne({ user: user._id }).lean();
  return profile?.privacy || {};
}

export async function setImage(user, field, file) {
  if (!file) throw forbidden('No image uploaded');
  const url = await saveImage(file);
  const previous = user[field];
  user[field] = url;
  await user.save();
  await removeUploads([previous]);
  return url;
}

export async function removeImage(user, field) {
  const previous = user[field];
  user[field] = '';
  await user.save();
  await removeUploads([previous]);
}

export async function arePostsReadableBy(viewerId, authorId) {
  const rel = await getRelations(viewerId);
  return !isBlockedEitherWay(rel, authorId);
}

export const areFriends = (a, b) => Friendship.exists(pairOf(a, b));
