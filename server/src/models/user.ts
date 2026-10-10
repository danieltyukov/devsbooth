import { Schema, model, type HydratedDocument } from 'mongoose';

export interface UserFields {
  email: string;
  /** Lowercase handle, set during onboarding. Absent until then. */
  username?: string;
  name?: string;
  bio: string;
  /** File name inside the avatars directory. */
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserFields>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, lowercase: true, trim: true },
    name: { type: String, trim: true },
    bio: { type: String, default: '', trim: true },
    avatar: { type: String },
  },
  { timestamps: true },
);

userSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } } });

export const User = model<UserFields>('User', userSchema, 'users');
export type UserDoc = HydratedDocument<UserFields>;
