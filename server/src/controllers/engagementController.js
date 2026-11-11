import * as comments from '../services/commentService.js';
import * as reactions from '../services/reactionService.js';
import * as search from '../services/searchService.js';
import * as notifications from '../services/notificationService.js';
import * as moderation from '../services/moderationService.js';

// ---- comments
export const listComments = async (req, res) => res.json(await comments.listComments(req.user, req.params.id, req.query));
export const listReplies = async (req, res) => res.json(await comments.listReplies(req.user, req.params.id, req.query));
export const createComment = async (req, res) => res.status(201).json(await comments.createComment(req.user, req.params.id, req.body));
export const editComment = async (req, res) => res.json(await comments.editComment(req.user, req.params.id, req.body.text));
export const deleteComment = async (req, res) => res.json(await comments.deleteComment(req.user, req.params.id));
export const pinComment = async (req, res) => res.json(await comments.setCommentPinned(req.user, req.params.id, req.body.pinned));

// ---- reactions
export const setReaction = async (req, res) => res.json(await reactions.setReaction(req.user, req.body.targetType, req.body.target, req.body.type));
export const removeReaction = async (req, res) => res.json(await reactions.removeReaction(req.user, req.query.targetType, req.query.target));
export const listReactions = async (req, res) => res.json(await reactions.listReactions(req.user, req.query.targetType, req.query.target, req.query));

// ---- search
export const people = async (req, res) => res.json({ items: await search.searchPeople(req.user, req.query.q, { limit: req.query.limit }) });
export const searchPosts = async (req, res) => res.json(await search.searchPosts(req.user, req.query.q, req.query));
export const hashtags = async (req, res) => res.json({ items: await search.searchHashtags(req.query.q) });
export const suggest = async (req, res) => res.json(await search.suggest(req.user, req.query.q));
export const trendingTags = async (_req, res) => res.json({ items: await search.trendingHashtags() });
export const recent = (req, res) => res.json({ items: req.user.recentSearches || [] });
export const addRecent = async (req, res) => res.json({ items: await search.addRecent(req.user, req.body.term) });
export const clearRecent = async (req, res) => res.json({ items: await search.clearRecent(req.user, req.query.term) });

// ---- notifications
export const listNotifications = async (req, res) => res.json(await notifications.listNotifications(req.user._id, { ...req.query, unreadOnly: req.query.unread === 'true' }));
export const unreadCount = async (req, res) => res.json({ unread: await notifications.unreadCount(req.user._id) });
export const markRead = async (req, res) => res.json(await notifications.markRead(req.user._id, req.body.ids));
export const deleteNotification = async (req, res) => res.json(await notifications.removeNotification(req.user._id, req.params.id));

// ---- reports
export const createReport = async (req, res) => res.status(201).json(await moderation.createReport(req.user, req.body));
