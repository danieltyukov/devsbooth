import { Schema, model } from 'mongoose';

/**
 * One emailed code, bound to the browser that asked for it through a random
 * challenge token. Several can be live for the same address at once.
 */
export interface LoginCodeFields {
  email: string;
  /** SHA-256 of the challenge token returned to the requesting browser. */
  challengeHash: string;
  /** SHA-256 of the requester's IP address, for the per-requester quota. The address is not stored. */
  requesterHash: string;
  salt: string;
  hash: string;
  /** Guesses made against this code, reserved before each comparison. */
  attempts: number;
  /** When the code stops working. */
  expiresAt: Date;
  /** When MongoDB deletes the record. Kept past expiry so the hourly cap can count it. */
  purgeAt: Date;
  createdAt: Date;
}

const loginCodeSchema = new Schema<LoginCodeFields>(
  {
    email: { type: String, required: true },
    challengeHash: { type: String, required: true, unique: true },
    requesterHash: { type: String, required: true },
    salt: { type: String, required: true },
    hash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    purgeAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

loginCodeSchema.index({ email: 1, createdAt: -1 });

export const LoginCode = model<LoginCodeFields>('LoginCode', loginCodeSchema, 'login_codes');
