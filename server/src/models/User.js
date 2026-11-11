import mongoose from 'mongoose';
import { ROLES, USER_STATUSES } from '../../../shared/constants.js';

const { Schema } = mongoose;

const notifPref = { type: Boolean, default: true };

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 30, match: /^[a-z0-9_]+$/ },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    passwordChangedAt: Date,

    name: { type: String, trim: true, maxlength: 60, default: '' },
    bio: { type: String, maxlength: 300, default: '' },
    avatar: { type: String, default: '' },
    cover: { type: String, default: '' },

    role: { type: String, enum: ROLES, default: 'user', index: true },
    status: { type: String, enum: USER_STATUSES, default: 'active', index: true },
    verifiedBadge: { type: Boolean, default: false },

    emailVerified: { type: Boolean, default: false },
    verifyTokenHash: { type: String, select: false },
    verifyTokenExpires: { type: Date, select: false },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },

    failedLogins: { type: Number, default: 0 },
    lockUntil: Date,

    twoFactor: {
      enabled: { type: Boolean, default: false },
      secret: { type: String, select: false },
      pendingSecret: { type: String, select: false },
      recoveryHashes: { type: [String], select: false, default: [] },
    },

    notificationPrefs: {
      friend_request: notifPref,
      friend_accept: notifPref,
      follow: notifPref,
      reaction: notifPref,
      comment: notifPref,
      reply: notifPref,
      mention: notifPref,
      tag: notifPref,
      share: notifPref,
      emailFriendRequests: { type: Boolean, default: false },
      emailSecurityAlerts: { type: Boolean, default: true },
    },

    hiddenPosts: { type: [Schema.Types.ObjectId], default: [] },
    snoozed: { type: [{ user: Schema.Types.ObjectId, until: Date, _id: false }], default: [] },
    recentSearches: { type: [String], default: [] },

    friendCount: { type: Number, default: 0 },
    followerCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },

    lastSeenAt: Date,
    deactivatedAt: Date,
  },
  { timestamps: true }
);

userSchema.index({ name: 1 });
userSchema.index({ createdAt: -1 });

export default mongoose.model('User', userSchema);
