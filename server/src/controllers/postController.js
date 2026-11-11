import * as posts from '../services/postService.js';
import { saveImages } from '../services/uploadService.js';
import { audit } from '../services/moderationService.js';

export const create = async (req, res) => {
  const urls = await saveImages(req.files || []);
  res.status(201).json(await posts.createPost(req.user, req.body, urls));
};

export const share = async (req, res) => {
  const body = { ...req.body, sharedPostId: req.params.id };
  res.status(201).json(await posts.createPost(req.user, body, []));
};

export const feed = async (req, res) => res.json(await posts.getFeed(req.user, req.query));
export const explore = async (req, res) => res.json(await posts.getExplore(req.user, req.query));
export const trending = async (req, res) => res.json(await posts.getTrending(req.user, req.query));
export const byUser = async (req, res) => res.json(await posts.getUserPosts(req.user, req.params.id, req.query));
export const byHashtag = async (req, res) => res.json(await posts.getHashtagPosts(req.user, req.params.tag, req.query));
export const getOne = async (req, res) => res.json(await posts.getPost(req.user._id, req.params.id));
export const edit = async (req, res) => res.json(await posts.editPost(req.user, req.params.id, req.body));

export const remove = async (req, res) => {
  const post = await posts.deletePost(req.user, req.params.id);
  if (String(post.author) !== String(req.user._id)) await audit(req.user, 'post.delete', 'post', post._id, {}, req.ip);
  res.json({ message: 'Post deleted' });
};

export const pin = async (req, res) => res.json(await posts.setPinned(req.user, req.params.id, req.body.pinned));
export const save = async (req, res) => res.json(await posts.savePost(req.user, req.params.id, req.body.collection));
export const unsave = async (req, res) => res.json(await posts.unsavePost(req.user, req.params.id));
export const hide = async (req, res) => res.json(await posts.hidePost(req.user, req.params.id));
export const vote = async (req, res) => res.json(await posts.votePoll(req.user, req.params.id, req.body.options));
export const audienceMembers = async (req, res) => res.json({ items: await posts.postAudienceMembers(req.user, req.params.id) });

export const snooze = async (req, res) => {
  const post = await posts.getPost(req.user._id, req.params.id);
  res.json(await posts.snoozeAuthor(req.user, post.author._id, req.body.days || 30));
};

export const saved = async (req, res) => res.json(await posts.getSavedPosts(req.user, req.query));
export const savedCollections = async (req, res) => res.json({ items: await posts.savedCollections(req.user) });
