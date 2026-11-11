import mongoose from 'mongoose';

const { Schema } = mongoose;

// One document per issued refresh token. Rotating a token creates a new document in the same
// `family`. Presenting an already-rotated token is treated as theft and revokes the whole family.
const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    family: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    userAgent: { type: String, default: '' },
    device: { type: String, default: '' },
    ip: { type: String, default: '' },
    remember: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: Date.now },
    rotatedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    createdFamilyAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

sessionSchema.index({ expiresAt: 1 });

export default mongoose.model('Session', sessionSchema);
