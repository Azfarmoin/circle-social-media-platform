import mongoose from 'mongoose';
import { pairOf } from './Relationships.js';

const { Schema } = mongoose;
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });

// One conversation per pair of people. `a` and `b` are the two ids in sorted order so the pair
// has a single canonical key; unread counters are kept per side.
const conversationSchema = new Schema(
  {
    a: ref('User', { required: true }),
    b: ref('User', { required: true }),
    pair: { type: String, required: true, unique: true },
    lastMessage: {
      text: { type: String, default: '' },
      sender: ref('User'),
      at: Date,
    },
    unreadA: { type: Number, default: 0 },
    unreadB: { type: Number, default: 0 },
  },
  { timestamps: true }
);
conversationSchema.index({ a: 1, 'lastMessage.at': -1 });
conversationSchema.index({ b: 1, 'lastMessage.at': -1 });
export const Conversation = mongoose.model('Conversation', conversationSchema);

export const pairKey = (x, y) => {
  const { a, b } = pairOf(x, y);
  return `${a}_${b}`;
};

const messageSchema = new Schema(
  {
    conversation: ref('Conversation', { required: true }),
    sender: ref('User', { required: true }),
    text: { type: String, default: '', maxlength: 2000 },
    image: { type: String, default: null },
    readAt: Date,
    deletedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
messageSchema.index({ conversation: 1, _id: -1 });
export const Message = mongoose.model('Message', messageSchema);
