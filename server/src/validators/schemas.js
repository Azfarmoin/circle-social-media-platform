import { z } from 'zod';
import {
  AUDIENCES, FEELINGS, REACTIONS, RELATIONSHIP_STATUSES, REPORT_CATEGORIES, REPORT_TARGETS, ROLES,
  SORT_COMMENTS, VISIBILITY, WHO_CAN, LIMITS,
} from '../../../shared/constants.js';
import { objectId, text, json, cursorQuery, password } from './common.js';

const email = z.string().trim().toLowerCase().email().max(254);
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/, 'Usernames are 3-30 characters: letters, numbers and underscores');
const otp = z.string().trim().min(6).max(20);

// ------------------------------------------------------------------ auth
export const auth = {
  register: z.object({ username, email, password, name: text(LIMITS.name).optional().default('') }),
  login: z.object({ identifier: z.string().trim().toLowerCase().min(3).max(254), password: z.string().min(1).max(128), otp: otp.optional(), remember: z.boolean().optional() }),
  verifyEmail: z.object({ token: z.string().min(20).max(200) }),
  email: z.object({ email }),
  resetPassword: z.object({ token: z.string().min(20).max(200), newPassword: password }),
  changePassword: z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }),
  passwordOnly: z.object({ password: z.string().min(1).max(128) }),
  twoFactorEnable: z.object({ code: z.string().regex(/^\d{6}$/) }),
  twoFactorDisable: z.object({ password: z.string().min(1).max(128), code: otp }),
  family: z.object({ family: z.string().uuid() }),
};

// ------------------------------------------------------------------ profile
const year = z.number().int().min(1900).max(2100).optional();
export const profile = {
  update: z.object({
    name: text(LIMITS.name).optional(),
    bio: text(LIMITS.bio).optional(),
    website: z.string().trim().max(200).refine((v) => v === '' || /^https?:\/\//i.test(v), 'Website must start with http:// or https://').optional(),
    location: text(100).optional(),
    relationshipStatus: z.enum([...RELATIONSHIP_STATUSES, '']).optional(),
    birthday: z.coerce.date().max(new Date()).nullable().optional(),
    languages: z.array(text(40, { min: 1 })).max(10).optional(),
    education: z.array(z.object({ school: text(100, { min: 1 }), degree: text(100).optional(), from: year, to: year })).max(10).optional(),
    work: z.array(z.object({ company: text(100, { min: 1 }), position: text(100).optional(), from: year, to: year })).max(10).optional(),
  }),
  privacy: z.object({
    profileVisibility: z.enum(VISIBILITY),
    aboutVisibility: z.enum(VISIBILITY),
    friendListVisibility: z.enum(VISIBILITY),
    birthdayVisibility: z.enum(VISIBILITY),
    defaultPostAudience: z.enum(AUDIENCES).refine((v) => !['friends_except', 'specific'].includes(v), 'Choose a simple default audience'),
    whoCanSendFriendRequests: z.enum(['everyone', 'nobody']),
    whoCanFollow: z.enum(['everyone', 'nobody']),
    whoCanTag: z.enum(WHO_CAN),
    whoCanComment: z.enum(WHO_CAN),
    whoCanMessage: z.enum(WHO_CAN),
    showOnlineStatus: z.boolean(),
    readReceipts: z.boolean(),
  }).partial().refine((o) => Object.keys(o).length > 0, 'Nothing to update'),
  username: z.object({ username }),
  usernameParam: z.object({ username: z.string().regex(/^[A-Za-z0-9_]{1,30}$/, 'Invalid username') }),
  notificationPrefs: z.object({
    friend_request: z.boolean(), friend_accept: z.boolean(), follow: z.boolean(), reaction: z.boolean(), comment: z.boolean(),
    reply: z.boolean(), mention: z.boolean(), tag: z.boolean(), share: z.boolean(), emailFriendRequests: z.boolean(), emailSecurityAlerts: z.boolean(),
  }).partial().refine((o) => Object.keys(o).length > 0, 'Nothing to update'),
};

// ------------------------------------------------------------------ posts
const poll = z.object({
  question: text(LIMITS.pollQuestion, { min: 1 }),
  options: z.array(text(LIMITS.pollOptionText, { min: 1 })).min(LIMITS.minPollOptions).max(LIMITS.maxPollOptions),
  multiple: z.boolean().optional(),
  durationHours: z.number().int().min(1).max(24 * 30).optional(),
});
const feeling = z.enum(FEELINGS.map((f) => f.label));

export const post = {
  create: z.object({
    text: text(LIMITS.postText).optional().default(''),
    audience: z.enum(AUDIENCES).optional(),
    audienceList: json(z.array(objectId).max(LIMITS.maxAudienceList)).optional(),
    tags: json(z.array(objectId).max(30)).optional(),
    location: text(100).optional(),
    feeling: feeling.optional(),
    poll: json(poll).optional(),
    sharedPostId: objectId.optional(),
  }),
  edit: z.object({
    text: text(LIMITS.postText).optional(),
    audience: z.enum(AUDIENCES).optional(),
    audienceList: z.array(objectId).max(LIMITS.maxAudienceList).optional(),
    location: text(100).optional(),
    feeling: feeling.nullable().optional(),
  }).refine((o) => Object.keys(o).length > 0, 'Nothing to update'),
  listQuery: cursorQuery.extend({ kind: z.enum(['all', 'photos', 'tagged']).optional() }),
  pin: z.object({ pinned: z.boolean() }),
  save: z.object({ collection: text(60).optional() }),
  snooze: z.object({ days: z.number().int().min(1).max(90).optional() }),
  vote: z.object({ options: z.array(objectId).min(1).max(LIMITS.maxPollOptions) }),
  hashtag: z.object({ tag: z.string().regex(/^[\p{L}\p{N}_]{2,40}$/u) }),
};

export const comment = {
  create: z.object({ text: text(LIMITS.commentText, { min: 1 }), parentId: objectId.optional() }),
  edit: z.object({ text: text(LIMITS.commentText, { min: 1 }) }),
  list: cursorQuery.extend({ sort: z.enum(SORT_COMMENTS).optional() }),
  pin: z.object({ pinned: z.boolean() }),
};

export const reaction = {
  set: z.object({ targetType: z.enum(['post', 'comment']), target: objectId, type: z.enum(REACTIONS) }),
  remove: z.object({ targetType: z.enum(['post', 'comment']), target: objectId }),
  list: cursorQuery.extend({ targetType: z.enum(['post', 'comment']), target: objectId, type: z.enum(REACTIONS).optional() }),
};

export const friends = {
  listQuery: cursorQuery,
  requests: cursorQuery.extend({ direction: z.enum(['incoming', 'outgoing']).optional() }),
  blockType: z.object({ type: z.enum(['block', 'restrict']).optional() }),
};

export const search = {
  q: z.object({ q: z.string().trim().min(1).max(80) }),
  query: cursorQuery.extend({ q: z.string().trim().min(1).max(80) }),
  recent: z.object({ term: z.string().trim().min(1).max(80) }),
};

export const notifications = {
  list: cursorQuery.extend({ unread: z.enum(['true', 'false']).optional() }),
  read: z.object({ ids: z.array(objectId).max(100).optional() }),
};

export const report = {
  create: z.object({ targetType: z.enum(REPORT_TARGETS), target: objectId, category: z.enum(REPORT_CATEGORIES), details: text(1000).optional().default('') }),
};

export const admin = {
  users: cursorQuery.extend({ q: z.string().trim().max(80).optional(), status: z.enum(['active', 'deactivated', 'suspended', 'banned']).optional(), role: z.enum(ROLES).optional() }),
  moderate: z.object({ action: z.enum(['suspend', 'ban', 'reinstate', 'verify', 'unverify', 'set_role']), role: z.enum(ROLES).optional(), reason: text(300).optional() })
    .refine((o) => o.action !== 'set_role' || !!o.role, 'role is required for set_role'),
  reports: cursorQuery.extend({ status: z.enum(['open', 'resolved', 'dismissed', 'all']).optional() }),
  resolve: z.object({ status: z.enum(['resolved', 'dismissed']), removeContent: z.boolean().optional(), note: text(300).optional() }),
};

export const message = {
  open: z.object({ userId: objectId }),
  send: z.object({ text: text(LIMITS.messageText).optional().default('') }),
  list: cursorQuery,
  convParam: z.object({ id: objectId }),
};
