import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import type { Types } from 'mongoose';
import { Session } from '../models/session';
import { User, type UserDoc } from '../models/user';

export const SESSION_COOKIE = 'devsbooth_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sessions are extended on use once less than this much time is left. */
const SESSION_RENEW_MS = 15 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: Types.ObjectId, userAgent: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await Session.create({
    tokenHash: hashToken(token),
    user: userId,
    userAgent: userAgent.slice(0, 300),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export interface ActiveSession {
  user: UserDoc;
  /** Whether the expiry moved, in which case the cookie should be re-sent. */
  renewed: boolean;
}

export async function findSession(token: string): Promise<ActiveSession | null> {
  if (!token) return null;
  const session = await Session.findOne({ tokenHash: hashToken(token) });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  const user = await User.findById(session.user);
  if (!user) return null;

  let renewed = false;
  if (session.expiresAt.getTime() - Date.now() < SESSION_RENEW_MS) {
    session.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await session.save();
    renewed = true;
  }
  return { user, renewed };
}

export async function destroySession(token: string): Promise<void> {
  await Session.deleteOne({ tokenHash: hashToken(token) });
}

function cookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/' };
}

export function setSessionCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(secure), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions(secure));
}
