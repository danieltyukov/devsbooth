import { Schema, model } from 'mongoose';

export interface LoginCodeFields {
  email: string;
  salt: string;
  hash: string;
  /** Wrong guesses against the current code. */
  attempts: number;
  sentAt: Date;
  /** When the current code stops working. */
  expiresAt: Date;
  /** Wrong guesses for this address since `windowStartedAt`, across re-sent codes. */
  failures: number;
  windowStartedAt: Date;
  /** When MongoDB deletes the record: after the code expires and the failure window closes. */
  purgeAt: Date;
}

const loginCodeSchema = new Schema<LoginCodeFields>({
  email: { type: String, required: true, unique: true },
  salt: { type: String, required: true },
  hash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  sentAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  failures: { type: Number, default: 0 },
  windowStartedAt: { type: Date, required: true },
  purgeAt: { type: Date, required: true, expires: 0 },
});

export const LoginCode = model<LoginCodeFields>('LoginCode', loginCodeSchema, 'login_codes');
