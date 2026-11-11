import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole, requireCsrf } from '../middleware/auth.js';
import { authLimiter, writeLimiter, createLimiter, messageLimiter } from '../middleware/rateLimit.js';
import { uploadImage, uploadImages } from '../middleware/upload.js';
import * as v from '../validators/schemas.js';
import { idParam, cursorQuery } from '../validators/common.js';
import { z } from 'zod';
import * as authC from '../controllers/authController.js';
import * as profileC from '../controllers/profileController.js';
import * as friendC from '../controllers/friendController.js';
import * as postC from '../controllers/postController.js';
import * as engC from '../controllers/engagementController.js';
import * as adminC from '../controllers/adminController.js';
import * as msgC from '../controllers/messageController.js';

const api = Router();
const id = { params: idParam };
const page = { query: cursorQuery };

// ======================================================================== /api/auth
const auth = Router();
auth.post('/register', authLimiter, validate({ body: v.auth.register }), authC.register);
auth.post('/verify-email', authLimiter, validate({ body: v.auth.verifyEmail }), authC.verifyEmail);
auth.post('/resend-verification', authLimiter, validate({ body: v.auth.email }), authC.resendVerification);
auth.post('/login', authLimiter, validate({ body: v.auth.login }), authC.login);
auth.post('/refresh', requireCsrf, authC.refresh);
auth.post('/logout', requireCsrf, authC.logout);
auth.post('/forgot-password', authLimiter, validate({ body: v.auth.email }), authC.forgotPassword);
auth.post('/reset-password', authLimiter, validate({ body: v.auth.resetPassword }), authC.resetPassword);

auth.use(authenticate);
auth.get('/me', authC.me);
auth.post('/logout-all', authC.logoutAll);
auth.post('/change-password', authLimiter, validate({ body: v.auth.changePassword }), authC.changePassword);
auth.get('/sessions', authC.sessions);
auth.delete('/sessions/:family', validate({ params: v.auth.family }), authC.revokeSession);
auth.get('/login-history', authC.loginHistory);
auth.post('/2fa/setup', authC.twoFactorSetup);
auth.post('/2fa/enable', authLimiter, validate({ body: v.auth.twoFactorEnable }), authC.twoFactorEnable);
auth.post('/2fa/disable', authLimiter, validate({ body: v.auth.twoFactorDisable }), authC.twoFactorDisable);
auth.post('/deactivate', authLimiter, validate({ body: v.auth.passwordOnly }), authC.deactivate);
auth.delete('/account', authLimiter, validate({ body: v.auth.passwordOnly }), authC.deleteAccount);
api.use('/auth', auth);

// everything below requires a signed-in user, and write verbs are rate limited per user
api.use(authenticate);
api.use((req, res, next) => (req.method === 'GET' ? next() : writeLimiter(req, res, next)));

// ======================================================================== /api/profiles
const profiles = Router();
profiles.put('/me', validate({ body: v.profile.update }), profileC.update);
profiles.put('/me/username', validate({ body: v.profile.username }), profileC.changeUsername);
profiles.post('/me/avatar', uploadImage('image'), profileC.setAvatar);
profiles.post('/me/cover', uploadImage('image'), profileC.setCover);
profiles.delete('/me/avatar', profileC.removeAvatar);
profiles.delete('/me/cover', profileC.removeCover);
profiles.get('/me/privacy', profileC.getPrivacy);
profiles.put('/me/privacy', validate({ body: v.profile.privacy }), profileC.updatePrivacy);
profiles.put('/me/notification-preferences', validate({ body: v.profile.notificationPrefs }), profileC.updateNotificationPrefs);
profiles.get('/:username', validate({ params: v.profile.usernameParam }), profileC.get);
api.use('/profiles', profiles);

// ======================================================================== /api/users (blocking, restricting)
const users = Router();
users.get('/blocked', profileC.listBlocked);
users.post('/:id/block', validate({ ...id, body: v.friends.blockType }), profileC.block);
users.delete('/:id/block', validate(id), profileC.unblock);
api.use('/users', users);

// ======================================================================== /api/friends and /api/follow
const friends = Router();
friends.get('/', validate({ query: v.friends.listQuery }), friendC.myFriends);
friends.get('/suggestions', friendC.suggestions);
friends.get('/requests', validate({ query: v.friends.requests }), friendC.requests);
friends.post('/requests/:id', validate(id), friendC.sendRequest);
friends.post('/requests/:id/accept', validate(id), friendC.accept);
friends.post('/requests/:id/reject', validate(id), friendC.reject);
friends.delete('/requests/:id', validate(id), friendC.cancel);
friends.get('/mutual/:id', validate(id), friendC.mutual);
friends.get('/user/:id', validate({ ...id, query: v.friends.listQuery }), friendC.userFriends);
friends.delete('/:id', validate(id), friendC.remove);
api.use('/friends', friends);

const follow = Router();
follow.post('/:id', validate(id), friendC.follow);
follow.delete('/:id', validate(id), friendC.unfollow);
follow.get('/followers/:id', validate({ ...id, ...page }), friendC.followers);
follow.get('/following/:id', validate({ ...id, ...page }), friendC.following);
api.use('/follow', follow);

// ======================================================================== /api/posts
const posts = Router();
posts.post('/', createLimiter, uploadImages('images'), validate({ body: v.post.create }), postC.create);
posts.get('/feed', validate({ query: cursorQuery }), postC.feed);
posts.get('/explore', validate({ query: cursorQuery }), postC.explore);
posts.get('/trending', validate({ query: cursorQuery }), postC.trending);
posts.get('/user/:id', validate({ ...id, query: v.post.listQuery }), postC.byUser);
posts.get('/hashtag/:tag', validate({ params: v.post.hashtag, query: cursorQuery }), postC.byHashtag);
posts.get('/:id', validate(id), postC.getOne);
posts.patch('/:id', validate({ ...id, body: v.post.edit }), postC.edit);
posts.delete('/:id', validate(id), postC.remove);
posts.put('/:id/pin', validate({ ...id, body: v.post.pin }), postC.pin);
posts.put('/:id/save', validate({ ...id, body: v.post.save }), postC.save);
posts.delete('/:id/save', validate(id), postC.unsave);
posts.post('/:id/hide', validate(id), postC.hide);
posts.post('/:id/snooze', validate({ ...id, body: v.post.snooze }), postC.snooze);
posts.post('/:id/vote', validate({ ...id, body: v.post.vote }), postC.vote);
posts.post('/:id/share', createLimiter, validate({ ...id, body: v.post.create.pick({ text: true, audience: true, audienceList: true }) }), postC.share);
posts.get('/:id/audience', validate(id), postC.audienceMembers);
api.use('/posts', posts);

const saved = Router();
saved.get('/', validate({ query: cursorQuery.extend({ collection: z.string().max(60).optional() }) }), postC.saved);
saved.get('/collections', postC.savedCollections);
api.use('/saved', saved);

// ======================================================================== /api/comments
const comments = Router();
comments.get('/post/:id', validate({ ...id, query: v.comment.list }), engC.listComments);
comments.post('/post/:id', createLimiter, validate({ ...id, body: v.comment.create }), engC.createComment);
comments.get('/:id/replies', validate({ ...id, query: cursorQuery }), engC.listReplies);
comments.patch('/:id', validate({ ...id, body: v.comment.edit }), engC.editComment);
comments.delete('/:id', validate(id), engC.deleteComment);
comments.put('/:id/pin', validate({ ...id, body: v.comment.pin }), engC.pinComment);
api.use('/comments', comments);

// ======================================================================== /api/reactions
const reactions = Router();
reactions.get('/', validate({ query: v.reaction.list }), engC.listReactions);
reactions.put('/', validate({ body: v.reaction.set }), engC.setReaction);
reactions.delete('/', validate({ query: v.reaction.remove }), engC.removeReaction);
api.use('/reactions', reactions);

// ======================================================================== /api/search
const search = Router();
search.get('/people', validate({ query: v.search.query }), engC.people);
search.get('/posts', validate({ query: v.search.query }), engC.searchPosts);
search.get('/hashtags', validate({ query: v.search.q }), engC.hashtags);
search.get('/suggest', validate({ query: v.search.q }), engC.suggest);
search.get('/trending', engC.trendingTags);
search.get('/recent', engC.recent);
search.post('/recent', validate({ body: v.search.recent }), engC.addRecent);
search.delete('/recent', engC.clearRecent);
api.use('/search', search);

// ======================================================================== /api/notifications
const notifications = Router();
notifications.get('/', validate({ query: v.notifications.list }), engC.listNotifications);
notifications.get('/unread-count', engC.unreadCount);
notifications.post('/read', validate({ body: v.notifications.read }), engC.markRead);
notifications.delete('/:id', validate(id), engC.deleteNotification);
api.use('/notifications', notifications);

// ======================================================================== /api/messages
const messages = Router();
messages.get('/conversations', validate({ query: v.message.list }), msgC.conversations);
messages.post('/conversations', validate({ body: v.message.open }), msgC.open);
messages.get('/conversations/:id', validate(id), msgC.one);
messages.get('/conversations/:id/messages', validate({ params: v.message.convParam, query: v.message.list }), msgC.messages);
messages.post('/conversations/:id/messages', messageLimiter, uploadImage('image'), validate({ params: v.message.convParam, body: v.message.send }), msgC.send);
messages.post('/conversations/:id/read', validate(id), msgC.read);
messages.get('/unread-count', msgC.unread);
messages.delete('/:id', validate(id), msgC.remove);
api.use('/messages', messages);

// ======================================================================== /api/reports
api.post('/reports', validate({ body: v.report.create }), engC.createReport);

// ======================================================================== /api/admin (moderators and admins)
const admin = Router();
admin.use(requireRole('moderator', 'admin'));
admin.get('/stats', adminC.stats);
admin.get('/reports', validate({ query: v.admin.reports }), adminC.reports);
admin.patch('/reports/:id', validate({ ...id, body: v.admin.resolve }), adminC.resolveReport);
admin.delete('/posts/:id', validate(id), adminC.deletePost);
admin.get('/users', validate({ query: v.admin.users }), adminC.users);
admin.patch('/users/:id', validate({ ...id, body: v.admin.moderate }), adminC.moderateUser);
admin.get('/audit-logs', validate({ query: cursorQuery }), adminC.auditLogs);
api.use('/admin', admin);

export default api;
