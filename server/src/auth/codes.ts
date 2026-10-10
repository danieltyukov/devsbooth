import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { LIMITS } from '@devsbooth/shared';
import { HttpError } from '../http/errors';
import { LoginCode } from '../models/login-code';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 30 * 1000;
export const MAX_ATTEMPTS = 5;

function hashCode(salt: string, code: string): string {
  return createHmac('sha256', salt).update(code).digest('hex');
}

/** Creates a fresh code for `email`, replacing any earlier one, and returns it in plain text. */
export async function issueCode(email: string, now = new Date()): Promise<string> {
  const existing = await LoginCode.findOne({ email }).lean();
  if (existing && now.getTime() - existing.sentAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new HttpError(429, 'too_many_requests', 'A code was just sent. Wait a few seconds before asking again.');
  }

  const code = randomInt(0, 10 ** LIMITS.codeLength)
    .toString()
    .padStart(LIMITS.codeLength, '0');
  const salt = randomBytes(16).toString('hex');
  await LoginCode.findOneAndUpdate(
    { email },
    {
      email,
      salt,
      hash: hashCode(salt, code),
      attempts: 0,
      sentAt: now,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    },
    { upsert: true },
  );
  return code;
}

/** Checks `code` for `email` and deletes it on success. Throws on a wrong, expired or exhausted code. */
export async function consumeCode(email: string, code: string, now = new Date()): Promise<void> {
  const record = await LoginCode.findOne({ email });
  if (!record || record.expiresAt.getTime() <= now.getTime()) {
    throw new HttpError(400, 'code_expired', 'This code has expired. Ask for a new one.');
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await record.deleteOne();
    throw new HttpError(400, 'code_expired', 'Too many wrong attempts. Ask for a new code.');
  }

  const expected = Buffer.from(record.hash, 'hex');
  const actual = Buffer.from(hashCode(record.salt, code), 'hex');
  if (!timingSafeEqual(expected, actual)) {
    record.attempts += 1;
    await record.save();
    throw new HttpError(400, 'code_invalid', 'That code is not right. Check the email and try again.');
  }
  await record.deleteOne();
}
