import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { LIMITS } from '@devsbooth/shared';
import { HttpError } from '../http/errors';
import { LoginCode } from '../models/login-code';

export const CODE_TTL_MS = 10 * 60 * 1000;
/** Guesses allowed against one code. */
export const MAX_ATTEMPTS = 3;
export const CODE_WINDOW_MS = 60 * 60 * 1000;
/** Codes one requester (IP address) can have sent to one address per window. */
export const MAX_CODES_PER_REQUESTER = 5;
/**
 * Codes one address can be sent per window from all requesters together. With 8-digit codes and
 * MAX_ATTEMPTS this bounds guessing to 60 per hour per address, about one chance in 70,000 per day
 * of sustained attack. Keying the tighter quota on the requester means a single attacker cannot
 * use up the quota of the address's owner.
 */
export const MAX_CODES_PER_ADDRESS = 20;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Key for pseudonymizing requester IPs. A plain hash of an IPv4 address can be reversed by trying
 * all 2^32 of them, so the stored value is an HMAC under a key that exists only in this process.
 * A restart forgets the key, which only resets the hourly per-requester counts.
 */
const requesterKey = randomBytes(32);
const pseudonymize = (requester: string) =>
  createHmac('sha256', requesterKey).update(requester).digest('hex');
const hashCode = (salt: string, code: string) => createHmac('sha256', salt).update(code).digest('hex');

export interface IssuedCode {
  code: string;
  /** Returned to the requesting browser only; needed to redeem the code. */
  challenge: string;
}

/**
 * Creates a new code for `email`. Earlier codes stay valid: each is bound to the
 * browser that requested it, so requesting a code cannot cancel someone else's.
 */
export async function issueCode(email: string, requester: string, now = new Date()): Promise<IssuedCode> {
  const code = randomInt(0, 10 ** LIMITS.codeLength)
    .toString()
    .padStart(LIMITS.codeLength, '0');
  const challenge = randomBytes(32).toString('base64url');
  const salt = randomBytes(16).toString('hex');

  const record = await LoginCode.create({
    email,
    challengeHash: sha256(challenge),
    requesterHash: pseudonymize(requester),
    salt,
    hash: hashCode(salt, code),
    attempts: 0,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    purgeAt: new Date(now.getTime() + CODE_WINDOW_MS),
    createdAt: now,
  });

  // Insert first, then count: concurrent requests may all be refused, but never too many accepted.
  const since = new Date(now.getTime() - CODE_WINDOW_MS);
  const [fromRequester, toAddress] = await Promise.all([
    LoginCode.countDocuments({ email, requesterHash: record.requesterHash, createdAt: { $gt: since } }),
    LoginCode.countDocuments({ email, createdAt: { $gt: since } }),
  ]);
  if (fromRequester > MAX_CODES_PER_REQUESTER || toAddress > MAX_CODES_PER_ADDRESS) {
    await record.deleteOne();
    throw new HttpError(
      429,
      'too_many_requests',
      'Too many codes were sent to this address. Wait a while and try again.',
    );
  }
  return { code, challenge };
}

/** Removes a code that could not be delivered, so it does not count toward the hourly cap. */
export async function discardCode(challenge: string): Promise<void> {
  await LoginCode.deleteOne({ challengeHash: sha256(challenge) });
}

const expired = (message = 'This code has expired. Ask for a new one.') =>
  new HttpError(400, 'code_expired', message);

/** Redeems `code` for `email` from the browser holding `challenge`, then clears the address's codes. */
export async function consumeCode(
  email: string,
  code: string,
  challenge: string,
  now = new Date(),
): Promise<void> {
  // Reserve an attempt atomically before comparing, so parallel guesses cannot exceed the limit.
  const record = await LoginCode.findOneAndUpdate(
    { challengeHash: sha256(challenge), email, expiresAt: { $gt: now }, attempts: { $lt: MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  ).lean();

  if (!record) {
    const spent = await LoginCode.exists({
      challengeHash: sha256(challenge),
      email,
      expiresAt: { $gt: now },
    });
    throw spent ? expired('Too many wrong attempts. Ask for a new code.') : expired();
  }

  const expected = Buffer.from(record.hash, 'hex');
  const actual = Buffer.from(hashCode(record.salt, code), 'hex');
  if (!timingSafeEqual(expected, actual)) {
    throw new HttpError(400, 'code_invalid', 'That code is not right. Check the email and try again.');
  }
  // Only one of several parallel correct submissions wins the delete.
  const { deletedCount } = await LoginCode.deleteOne({ _id: record._id });
  if (deletedCount !== 1) throw expired('This code was already used. Ask for a new one.');
  // Signed in: the other codes for this address are no longer needed. Keep the records that
  // count toward the hourly cap, but make them unusable.
  await LoginCode.updateMany({ email, expiresAt: { $gt: now } }, { expiresAt: now });
}
