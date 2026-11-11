import mongoose from 'mongoose';
import { AUDIENCES } from '../../../shared/constants.js';

const { Schema } = mongoose;

const countsDefault = () => ({ like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 });
export { countsDefault };

const mediaSchema = new Schema({ url: { type: String, required: true }, kind: { type: String, enum: ['image'], default: 'image' }, alt: { type: String, default: '', maxlength: 200 } }, { _id: false });

const pollOptionSchema = new Schema({ text: { type: String, required: true, maxlength: 80 } });

const postSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['text', 'photo', 'poll', 'share'], default: 'text' },
    text: { type: String, default: '', maxlength: 5000 },
    media: { type: [mediaSchema], default: [] },

    audience: { type: String, enum: AUDIENCES, default: 'friends' },
    audienceList: { type: [Schema.Types.ObjectId], default: [] },
    authorActive: { type: Boolean, default: true },

    tags: { type: [Schema.Types.ObjectId], default: [] },
    mentions: { type: [Schema.Types.ObjectId], default: [] },
    hashtags: { type: [String], default: [] },
    location: { type: String, default: '', maxlength: 100 },
    feeling: { emoji: String, label: String },

    poll: {
      question: { type: String, maxlength: 200 },
      options: { type: [pollOptionSchema], default: undefined },
      multiple: { type: Boolean, default: false },
      endsAt: Date,
      totalVotes: { type: Number, default: 0 },
      // vote tally keyed by option id; plain dotted $inc paths keep updates atomic and portable
      counts: { type: Object, default: {} },
    },

    sharedPost: { type: Schema.Types.ObjectId, ref: 'Post' },
    pinned: { type: Boolean, default: false },

    reactionCounts: { type: Object, default: countsDefault },
    reactionTotal: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    shareCount: { type: Number, default: 0 },

    editedAt: Date,
  },
  { timestamps: true, minimize: false }
);

postSchema.index({ author: 1, _id: -1 });
postSchema.index({ audience: 1, _id: -1 });
postSchema.index({ hashtags: 1, _id: -1 });
postSchema.index({ authorActive: 1, _id: -1 });
postSchema.index({ author: 1, pinned: 1 });

export default mongoose.model('Post', postSchema);
