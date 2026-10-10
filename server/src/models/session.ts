import { Schema, model, type Types } from 'mongoose';

export interface SessionFields {
  /** SHA-256 of the cookie value. The token itself is never stored. */
  tokenHash: string;
  user: Types.ObjectId;
  userAgent: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<SessionFields>(
  {
    tokenHash: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userAgent: { type: String, default: '' },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);

export const Session = model<SessionFields>('Session', sessionSchema, 'sessions');
