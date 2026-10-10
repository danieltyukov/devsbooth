import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { LIMITS } from '@devsbooth/shared';
import { consumeCode, issueCode } from '../auth/codes';
import type { Mailer } from '../auth/mailer';
import { clearSessionCookie, createSession, destroySession, setSessionCookie } from '../auth/sessions';
import { HttpError, parse } from '../http/errors';
import { log } from '../log';
import { User } from '../models/user';
import { toMe } from '../users/dto';

const email = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .toLowerCase()
  .max(LIMITS.emailMax, { error: 'That email address is too long.' })
  .pipe(z.email({ error: 'Enter a valid email address.' }));

const codeSchema = z.object({ email });
const verifySchema = z.object({
  email,
  code: z
    .string({ error: 'Enter the code from the email.' })
    .trim()
    .regex(new RegExp(`^\\d{${LIMITS.codeLength}}$`), { error: `The code is ${LIMITS.codeLength} digits.` }),
});

export function authRoutes(deps: { mailer: Mailer; secureCookies: boolean; limiter: RequestHandler }) {
  const router = Router();

  router.post('/code', deps.limiter, async (req, res) => {
    const input = parse(codeSchema, req.body);
    const code = await issueCode(input.email);
    try {
      await deps.mailer.sendCode(input.email, code);
    } catch (err) {
      log.error('Could not send sign-in email', { err });
      throw new HttpError(502, 'internal', 'We could not send the email. Try again in a minute.');
    }
    res.status(204).end();
  });

  router.post('/verify', deps.limiter, async (req, res) => {
    const input = parse(verifySchema, req.body);
    await consumeCode(input.email, input.code);
    const user =
      (await User.findOne({ email: input.email })) ?? (await User.create({ email: input.email, bio: '' }));
    const token = await createSession(user._id, req.get('user-agent') ?? '');
    setSessionCookie(res, token, deps.secureCookies);
    res.json({ user: toMe(user) });
  });

  router.post('/logout', async (req, res) => {
    if (req.sessionToken) await destroySession(req.sessionToken);
    clearSessionCookie(res, deps.secureCookies);
    res.status(204).end();
  });

  return router;
}
