import { http, csrfToken } from './http.js';

const d = (p) => p.then((r) => r.data);
const q = (params) => ({ params: Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')) });

export const authApi = {
  register: (b) => d(http.post('/auth/register', b)),
  login: (b) => d(http.post('/auth/login', b)),
  logout: () => d(http.post('/auth/logout', null, { headers: { 'X-CSRF-Token': csrfToken() } })),
  logoutAll: () => d(http.post('/auth/logout-all')),
  me: () => d(http.get('/auth/me')),
  verifyEmail: (token) => d(http.post('/auth/verify-email', { token })),
  resendVerification: (email) => d(http.post('/auth/resend-verification', { email })),
  forgot: (email) => d(http.post('/auth/forgot-password', { email })),
  reset: (b) => d(http.post('/auth/reset-password', b)),
  changePassword: (b) => d(http.post('/auth/change-password', b)),
  sessions: () => d(http.get('/auth/sessions')),
  revokeSession: (family) => d(http.delete(`/auth/sessions/${family}`)),
  history: () => d(http.get('/auth/login-history')),
  twoFactorSetup: () => d(http.post('/auth/2fa/setup')),
  twoFactorEnable: (code) => d(http.post('/auth/2fa/enable', { code })),
  twoFactorDisable: (b) => d(http.post('/auth/2fa/disable', b)),
  deactivate: (password) => d(http.post('/auth/deactivate', { password })),
  deleteAccount: (password) => d(http.delete('/auth/account', { data: { password } })),
};

export const profileApi = {
  get: (username) => d(http.get(`/profiles/${encodeURIComponent(username)}`)),
  update: (b) => d(http.put('/profiles/me', b)),
  changeUsername: (username) => d(http.put('/profiles/me/username', { username })),
  setImage: (kind, file) => {
    const f = new FormData();
    f.append('image', file);
    return d(http.post(`/profiles/me/${kind}`, f));
  },
  removeImage: (kind) => d(http.delete(`/profiles/me/${kind}`)),
  privacy: () => d(http.get('/profiles/me/privacy')),
  updatePrivacy: (b) => d(http.put('/profiles/me/privacy', b)),
  updateNotificationPrefs: (b) => d(http.put('/profiles/me/notification-preferences', b)),
  blocked: (type) => d(http.get('/users/blocked', q({ type }))),
  block: (id, type = 'block') => d(http.post(`/users/${id}/block`, { type })),
  unblock: (id) => d(http.delete(`/users/${id}/block`)),
};

export const friendApi = {
  list: (p) => d(http.get('/friends', q(p))),
  ofUser: (id, p) => d(http.get(`/friends/user/${id}`, q(p))),
  suggestions: (limit) => d(http.get('/friends/suggestions', q({ limit }))),
  requests: (p) => d(http.get('/friends/requests', q(p))),
  send: (id) => d(http.post(`/friends/requests/${id}`)),
  accept: (id) => d(http.post(`/friends/requests/${id}/accept`)),
  reject: (id) => d(http.post(`/friends/requests/${id}/reject`)),
  cancel: (id) => d(http.delete(`/friends/requests/${id}`)),
  remove: (id) => d(http.delete(`/friends/${id}`)),
  mutual: (id) => d(http.get(`/friends/mutual/${id}`)),
  follow: (id) => d(http.post(`/follow/${id}`)),
  unfollow: (id) => d(http.delete(`/follow/${id}`)),
};

export const postApi = {
  create: (form) => d(http.post('/posts', form)),
  feed: (p) => d(http.get('/posts/feed', q(p))),
  explore: (p) => d(http.get('/posts/explore', q(p))),
  trending: (p) => d(http.get('/posts/trending', q(p))),
  byUser: (id, p) => d(http.get(`/posts/user/${id}`, q(p))),
  byHashtag: (tag, p) => d(http.get(`/posts/hashtag/${encodeURIComponent(tag)}`, q(p))),
  get: (id) => d(http.get(`/posts/${id}`)),
  edit: (id, b) => d(http.patch(`/posts/${id}`, b)),
  remove: (id) => d(http.delete(`/posts/${id}`)),
  pin: (id, pinned) => d(http.put(`/posts/${id}/pin`, { pinned })),
  save: (id, collection) => d(http.put(`/posts/${id}/save`, collection ? { collection } : {})),
  unsave: (id) => d(http.delete(`/posts/${id}/save`)),
  hide: (id) => d(http.post(`/posts/${id}/hide`)),
  snooze: (id, days = 30) => d(http.post(`/posts/${id}/snooze`, { days })),
  vote: (id, options) => d(http.post(`/posts/${id}/vote`, { options })),
  share: (id, b) => d(http.post(`/posts/${id}/share`, b)),
  audience: (id) => d(http.get(`/posts/${id}/audience`)),
  saved: (p) => d(http.get('/saved', q(p))),
  savedCollections: () => d(http.get('/saved/collections')),
};

export const commentApi = {
  list: (postId, p) => d(http.get(`/comments/post/${postId}`, q(p))),
  create: (postId, b) => d(http.post(`/comments/post/${postId}`, b)),
  replies: (id, p) => d(http.get(`/comments/${id}/replies`, q(p))),
  edit: (id, text) => d(http.patch(`/comments/${id}`, { text })),
  remove: (id) => d(http.delete(`/comments/${id}`)),
  pin: (id, pinned) => d(http.put(`/comments/${id}/pin`, { pinned })),
};

export const reactionApi = {
  set: (targetType, target, type) => d(http.put('/reactions', { targetType, target, type })),
  remove: (targetType, target) => d(http.delete('/reactions', q({ targetType, target }))),
  list: (p) => d(http.get('/reactions', q(p))),
};

export const searchApi = {
  people: (p) => d(http.get('/search/people', q(p))),
  posts: (p) => d(http.get('/search/posts', q(p))),
  suggest: (query) => d(http.get('/search/suggest', q({ q: query }))),
  trending: () => d(http.get('/search/trending')),
  recent: () => d(http.get('/search/recent')),
  addRecent: (term) => d(http.post('/search/recent', { term })),
  clearRecent: (term) => d(http.delete('/search/recent', q({ term }))),
};

export const notificationApi = {
  list: (p) => d(http.get('/notifications', q(p))),
  unread: () => d(http.get('/notifications/unread-count')),
  read: (ids) => d(http.post('/notifications/read', ids ? { ids } : {})),
  remove: (id) => d(http.delete(`/notifications/${id}`)),
};

export const messageApi = {
  conversations: () => d(http.get('/messages/conversations')),
  open: (userId) => d(http.post('/messages/conversations', { userId })),
  conversation: (id) => d(http.get(`/messages/conversations/${id}`)),
  messages: (id, p) => d(http.get(`/messages/conversations/${id}/messages`, q(p))),
  send: (id, text, file) => {
    if (!file) return d(http.post(`/messages/conversations/${id}/messages`, { text }));
    const f = new FormData();
    f.append('text', text);
    f.append('image', file);
    return d(http.post(`/messages/conversations/${id}/messages`, f));
  },
  read: (id) => d(http.post(`/messages/conversations/${id}/read`)),
  unread: () => d(http.get('/messages/unread-count')),
  remove: (id) => d(http.delete(`/messages/${id}`)),
};

export const reportApi = { create: (b) => d(http.post('/reports', b)) };

export const adminApi = {
  stats: () => d(http.get('/admin/stats')),
  reports: (p) => d(http.get('/admin/reports', q(p))),
  resolve: (id, b) => d(http.patch(`/admin/reports/${id}`, b)),
  users: (p) => d(http.get('/admin/users', q(p))),
  moderate: (id, b) => d(http.patch(`/admin/users/${id}`, b)),
  deletePost: (id) => d(http.delete(`/admin/posts/${id}`)),
  audit: (p) => d(http.get('/admin/audit-logs', q(p))),
};
