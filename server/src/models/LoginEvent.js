import mongoose from 'mongoose';

const loginEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    success: { type: Boolean, required: true },
    reason: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    device: { type: String, default: '' },
    deviceKey: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

loginEventSchema.index({ user: 1, _id: -1 });
loginEventSchema.index({ user: 1, success: 1, deviceKey: 1 });

export default mongoose.model('LoginEvent', loginEventSchema);
