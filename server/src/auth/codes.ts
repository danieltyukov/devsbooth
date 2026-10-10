import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { LIMITS } from '@devsbooth/shared';
import { HttpError } from '../http/errors';
import { LoginCode } from '../models/login-code';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 30 * 1000;
/** Wrong guesses allowed against one code. */
export const MAX_ATTEMPTS = 5;
/** Wrong guesses allowed for one address per window, however many codes are requested. */
export const MAX_FAILURES = 10;
export const FAILURE_WINDOW_MS = 60 * 60 * 1000;

function hashCode(salt: string, code: string): string {
  return createHmac('sha256', salt).update(code).digest('hex');
}

const tooManyFailures = () =>
  new HttpError(429, 'too_many_requests', 'Too many wrong codes for this address. Try again in an hour.');

/** Creates a fresh code for `email`, replacing any earlier one, and returns it in plain text. */
export async function issueCode(email: string, now = new Date()): Promise<string> {
  const existing = await LoginCode.findOne({ email }).lean();
  let failures = 0;
  let windowStartedAt = now;
  if (existing) {
    if (now.getTime() - existing.sentAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new HttpError(429, 'too_many_requests', 'A code was just sent. Wait a few seconds before asking again.');
    }
    // Re-sending a code must not reset the failure budget, or guessing would be unlimited.
    if (now.getTime() - existing.windowStartedAt.getTime() < FAILURE_WINDOW_MS) {
      if (existing.failures >= MAX_FAILURES) throw tooManyFailures();
      failures = existing.failures;
      windowStartedAt = existing.windowStartedAt;
    }
  }

  const code = randomInt(0, 10 ** LIMITS.codeLength)
    .toString()
    .padStart(LIMITS.codeLength, '0');
  const salt = randomBytes(16).toString('hex');
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  const windowEnds = new Date(windowStartedAt.getTime() + FAILURE_WINDOW_MS);
  await LoginCode.findOneAndUpdate(
    { email },
    {
      email,
      salt,
      hash: hashCode(salt, code),
      attempts: 0,
      sentAt: now,
      expiresAt,
      failures,
      windowStartedAt,
      purgeAt: expiresAt > windowEnds ? expiresAt : windowEnds,
    },
    { upsert: true },
  );
  return code;
}

/** Checks `code` for `email` and deletes it on success. Throws on a wrong, expired or exhausted code. */
export async function consumeCode(email: string, code: string, now = new Date()): Promise<void> {
  // Reserve one attempt atomically before comparing, so parallel guesses cannot exceed the limits.
  const record = await LoginCode.findOneAndUpdate(
    { email, expiresAt: { $gt: now }, attempts: { $lt: MAX_ATTEMPTS }, failures: { $lt: MAX_FAILURES } },
    { $inc: { attempts: 1, failures: 1 } },
    { returnDocument: 'after' },
  ).lean();

  if (!record) {
    const existing = await LoginCode.findOne({ email }).lean();
    if (existing && existing.failures >= MAX_FAILURES) throw tooManyFailures();
    if (existing && existing.expiresAt > now && existing.attempts >= MAX_ATTEMPTS) {
      throw new HttpError(400, 'code_expired', 'Too many wrong attempts. Ask for a new code.');
    }
    throw new HttpError(400, 'code_expired', 'This code has expired. Ask for a new one.');
  }

  const expected = Buffer.from(record.hash, 'hex');
  const actual = Buffer.from(hashCode(record.salt, code), 'hex');
  if (!timingSafeEqual(expected, actual)) {
    throw new HttpError(400, 'code_invalid', 'That code is not right. Check the email and try again.');
  }
  // Deleting by hash means only one of several parallel correct submissions wins.
  const { deletedCount } = await LoginCode.deleteOne({ _id: record._id, hash: record.hash });
  if (deletedCount !== 1) throw new HttpError(400, 'code_expired', 'This code was already used. Ask for a new one.');
}
