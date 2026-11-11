import mongoose from 'mongoose';
import { RELATIONSHIP_STATUSES, VISIBILITY, WHO_CAN, AUDIENCES } from '../../../shared/constants.js';

const { Schema } = mongoose;

const education = new Schema({ school: { type: String, maxlength: 100 }, degree: { type: String, maxlength: 100 }, from: Number, to: Number }, { _id: false });
const work = new Schema({ company: { type: String, maxlength: 100 }, position: { type: String, maxlength: 100 }, from: Number, to: Number }, { _id: false });

const profileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    website: { type: String, default: '', maxlength: 200 },
    location: { type: String, default: '', maxlength: 100 },
    education: { type: [education], default: [] },
    work: { type: [work], default: [] },
    relationshipStatus: { type: String, enum: [...RELATIONSHIP_STATUSES, ''], default: '' },
    birthday: Date,
    languages: { type: [String], default: [] },
    featuredPosts: { type: [Schema.Types.ObjectId], default: [] },

    privacy: {
      profileVisibility: { type: String, enum: VISIBILITY, default: 'everyone' },
      aboutVisibility: { type: String, enum: VISIBILITY, default: 'everyone' },
      friendListVisibility: { type: String, enum: VISIBILITY, default: 'everyone' },
      birthdayVisibility: { type: String, enum: VISIBILITY, default: 'friends' },
      defaultPostAudience: { type: String, enum: AUDIENCES, default: 'friends' },
      whoCanSendFriendRequests: { type: String, enum: ['everyone', 'nobody'], default: 'everyone' },
      whoCanFollow: { type: String, enum: ['everyone', 'nobody'], default: 'everyone' },
      whoCanTag: { type: String, enum: WHO_CAN, default: 'friends' },
      whoCanComment: { type: String, enum: WHO_CAN, default: 'everyone' },
      whoCanMessage: { type: String, enum: WHO_CAN, default: 'everyone' },
      showOnlineStatus: { type: Boolean, default: true },
      readReceipts: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

export default mongoose.model('Profile', profileSchema);
