import mongoose from 'mongoose';
import { REACTIONS, NOTIFICATION_TYPES, REPORT_CATEGORIES, REPORT_TARGETS } from '../../../shared/constants.js';
import { countsDefault } from './Post.js';

const { Schema } = mongoose;
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });

// ---- Comment (top-level and replies share one collection; replies carry `parent`) ----
const commentSchema = new Schema(
  {
    post: ref('Post', { required: true }),
    author: ref('User', { required: true }),
    parent: ref('Comment', { default: null }),
    replyTo: ref('User'),
    text: { type: String, required: true, maxlength: 2000 },
    mentions: { type: [Schema.Types.ObjectId], default: [] },
    pinned: { type: Boolean, default: false },
    reactionCounts: { type: Object, default: countsDefault },
    reactionTotal: { type: Number, default: 0 },
    replyCount: { type: Number, default: 0 },
    editedAt: Date,
  },
  { timestamps: true, minimize: false }
);
commentSchema.index({ post: 1, parent: 1, _id: -1 });
commentSchema.index({ post: 1, parent: 1, reactionTotal: -1, _id: -1 });
commentSchema.index({ author: 1 });
export const Comment = mongoose.model('Comment', commentSchema);

// ---- Reaction (posts and comments) ----
const reactionSchema = new Schema(
  {
    user: ref('User', { required: true }),
    targetType: { type: String, enum: ['post', 'comment'], required: true },
    target: ref('Post', { required: true }),
    type: { type: String, enum: REACTIONS, required: true },
  },
  { timestamps: true }
);
reactionSchema.index({ user: 1, targetType: 1, target: 1 }, { unique: true });
reactionSchema.index({ targetType: 1, target: 1, type: 1, _id: -1 });
export const Reaction = mongoose.model('Reaction', reactionSchema);

// ---- PollVote ----
const pollVoteSchema = new Schema(
  { post: ref('Post', { required: true }), user: ref('User', { required: true }), options: { type: [Schema.Types.ObjectId], default: [] } },
  { timestamps: true }
);
pollVoteSchema.index({ post: 1, user: 1 }, { unique: true });
export const PollVote = mongoose.model('PollVote', pollVoteSchema);

// ---- Notification ----
const notificationSchema = new Schema(
  {
    recipient: ref('User', { required: true }),
    actor: ref('User'),
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    post: ref('Post'),
    comment: ref('Comment'),
    meta: { type: Object, default: {} },
    read: { type: Boolean, default: false },
  },
  { timestamps: true, minimize: false }
);
notificationSchema.index({ recipient: 1, _id: -1 });
notificationSchema.index({ recipient: 1, read: 1 });
export const Notification = mongoose.model('Notification', notificationSchema);

// ---- SavedItem ----
const savedSchema = new Schema(
  { user: ref('User', { required: true }), post: ref('Post', { required: true }), folder: { type: String, default: 'All', maxlength: 60 } },
  { timestamps: { createdAt: true, updatedAt: false } }
);
savedSchema.index({ user: 1, post: 1 }, { unique: true });
savedSchema.index({ user: 1, _id: -1 });
export const SavedItem = mongoose.model('SavedItem', savedSchema);

// ---- Hashtag counters ----
const hashtagSchema = new Schema({ tag: { type: String, required: true, unique: true }, postCount: { type: Number, default: 0 }, lastUsedAt: Date });
hashtagSchema.index({ postCount: -1 });
export const Hashtag = mongoose.model('Hashtag', hashtagSchema);

// ---- Report ----
const reportSchema = new Schema(
  {
    reporter: ref('User', { required: true }),
    targetType: { type: String, enum: REPORT_TARGETS, required: true },
    target: { type: Schema.Types.ObjectId, required: true },
    targetOwner: ref('User'),
    category: { type: String, enum: REPORT_CATEGORIES, required: true },
    details: { type: String, default: '', maxlength: 1000 },
    status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open' },
    resolvedBy: ref('User'),
    resolutionNote: { type: String, default: '' },
  },
  { timestamps: true }
);
reportSchema.index({ status: 1, _id: -1 });
reportSchema.index({ reporter: 1, targetType: 1, target: 1 });
export const Report = mongoose.model('Report', reportSchema);

// ---- AuditLog ----
const auditSchema = new Schema(
  {
    actor: ref('User'),
    action: { type: String, required: true },
    targetType: String,
    target: Schema.Types.ObjectId,
    meta: { type: Object, default: {} },
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);
export const AuditLog = mongoose.model('AuditLog', auditSchema);
