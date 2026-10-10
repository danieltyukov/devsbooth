import { Schema, model, type Types } from 'mongoose';

export interface FollowFields {
  follower: Types.ObjectId;
  followee: Types.ObjectId;
  createdAt: Date;
}

const followSchema = new Schema<FollowFields>(
  {
    follower: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    followee: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

followSchema.index({ follower: 1, followee: 1 }, { unique: true });

export const Follow = model<FollowFields>('Follow', followSchema, 'follows');
