import { parseCookie } from 'cookie';
import type { RequestHandler } from 'express';
import { forbidden, unauthorized } from '../http/errors';
import type { UserDoc } from '../models/user';
import { SESSION_COOKIE, findSession, setSessionCookie } from './sessions';

declare global {
  // Express merges request properties through this global namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDoc;
      sessionToken?: string;
    }
  }
}

/** Loads the signed-in user, if any, from the session cookie. Never rejects a request. */
export function loadSession(secureCookies: boolean): RequestHandler {
  return async (req, res, next) => {
    const token = parseCookie(req.headers.cookie ?? '')[SESSION_COOKIE];
    if (token) {
      const session = await findSession(token);
      if (session) {
        req.user = session.user;
        req.sessionToken = token;
        if (session.renewed) setSessionCookie(res, token, secureCookies);
      }
    }
    next();
  };
}

export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  next();
};

/** Requires a user who has picked a name and username. */
export const requireOnboarded: RequestHandler = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  if (!req.user.username || !req.user.name) throw forbidden('Finish setting up your profile first.');
  next();
};

/** The signed-in user. Only call behind `requireUser` or `requireOnboarded`. */
export function currentUser(req: Express.Request): UserDoc {
  if (!req.user) throw unauthorized();
  return req.user;
}
