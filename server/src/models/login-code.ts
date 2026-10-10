import { Schema, model } from 'mongoose';

export interface LoginCodeFields {
  email: string;
  salt: string;
  hash: string;
  attempts: number;
  sentAt: Date;
  expiresAt: Date;
}

const loginCodeSchema = new Schema<LoginCodeFields>({
  email: { type: String, required: true, unique: true },
  salt: { type: String, required: true },
  hash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  sentAt: { type: Date, required: true },
  // MongoDB removes the document once this date passes.
  expiresAt: { type: Date, required: true, expires: 0 },
});

export const LoginCode = model<LoginCodeFields>('LoginCode', loginCodeSchema, 'login_codes');
