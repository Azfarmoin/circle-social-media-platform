import mongoose from 'mongoose';

const { Schema } = mongoose;
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, required: true, ...extra });

// ---- FriendRequest ----
const friendRequestSchema = new Schema(
  {
    from: ref('User'),
    to: ref('User', { index: true }),
    status: { type: String, enum: ['pending', 'accepted', 'rejected', 'cancelled'], default: 'pending' },
  },
  { timestamps: true }
);
friendRequestSchema.index({ from: 1, to: 1 }, { unique: true });
friendRequestSchema.index({ to: 1, status: 1, _id: -1 });
friendRequestSchema.index({ from: 1, status: 1, _id: -1 });
export const FriendRequest = mongoose.model('FriendRequest', friendRequestSchema);

// ---- Friendship: one document per pair, stored with a < b so the pair is unique ----
const friendshipSchema = new Schema({ a: ref('User'), b: ref('User', { index: true }) }, { timestamps: { createdAt: true, updatedAt: false } });
friendshipSchema.index({ a: 1, b: 1 }, { unique: true });
export const Friendship = mongoose.model('Friendship', friendshipSchema);

export const pairOf = (x, y) => (String(x) < String(y) ? { a: x, b: y } : { a: y, b: x });

// ---- Follow ----
const followSchema = new Schema({ follower: ref('User'), following: ref('User', { index: true }) }, { timestamps: { createdAt: true, updatedAt: false } });
followSchema.index({ follower: 1, following: 1 }, { unique: true });
export const Follow = mongoose.model('Follow', followSchema);

// ---- Block / Restrict ----
const blockSchema = new Schema(
  { user: ref('User'), target: ref('User', { index: true }), type: { type: String, enum: ['block', 'restrict'], default: 'block' } },
  { timestamps: { createdAt: true, updatedAt: false } }
);
blockSchema.index({ user: 1, target: 1, type: 1 }, { unique: true });
export const Block = mongoose.model('Block', blockSchema);
