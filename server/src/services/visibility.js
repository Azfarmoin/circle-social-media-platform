import { Post } from '../models/index.js';
import { getRelations } from './relationService.js';
import { notFound } from '../utils/AppError.js';

// Builds the Mongo filter selecting only posts the viewer is allowed to see. This is the single
// source of truth for post privacy: feed, profile, search, hashtags, saved and permalink all use it.
export function visibilityFilter(viewerId, rel, now = new Date()) {
  const v = viewerId;
  const hiddenAuthors = rel.hiddenFromIds;
  const filter = {
    authorActive: true,
    $or: [
      { author: v },
      { audience: 'public' },
      { audience: 'friends', author: { $in: rel.friendIds } },
      { audience: 'friends_except', author: { $in: rel.friendIds }, audienceList: { $ne: v } },
      { audience: 'specific', audienceList: v },
    ],
  };
  if (hiddenAuthors.length) filter.author = { $nin: hiddenAuthors };
  return filter;
}

// Combine the visibility filter with extra constraints, including ones on `author`.
export const withVisibility = (viewerId, rel, extra = {}) => ({ $and: [visibilityFilter(viewerId, rel), extra] });

export async function loadViewablePost(viewerId, postId, { lean = false } = {}) {
  const rel = await getRelations(viewerId);
  const q = Post.findOne(withVisibility(viewerId, rel, { _id: postId }));
  const post = await (lean ? q.lean() : q);
  if (!post) throw notFound('Post not found');
  return { post, rel };
}
