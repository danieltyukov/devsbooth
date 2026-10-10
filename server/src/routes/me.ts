import express, { Router } from 'express';
import { z } from 'zod';
import { AVATAR_TYPES, LIMITS, USERNAME_PATTERN } from '@devsbooth/shared';
import { currentUser, requireUser } from '../auth/middleware';
import { HttpError, parse } from '../http/errors';
import { User } from '../models/user';
import { deleteAvatar, saveAvatar } from '../users/avatars';
import { toMe } from '../users/dto';

const profileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { error: 'Enter your name.' })
      .max(LIMITS.nameMax, { error: `Keep it under ${LIMITS.nameMax} characters.` }),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(USERNAME_PATTERN, {
        error: `${LIMITS.usernameMin} to ${LIMITS.usernameMax} characters: letters, digits and underscores.`,
      }),
    bio: z
      .string()
      .trim()
      .max(LIMITS.bioMax, { error: `Keep it under ${LIMITS.bioMax} characters.` }),
  })
  .partial();

/** Usernames that would collide with app routes or read as official. */
const RESERVED = new Set(['admin', 'api', 'devsbooth', 'me', 'moderator', 'root', 'settings', 'support', 'system']);

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

export function meRoutes(deps: { avatarsDir: string }) {
  const router = Router();
  router.use(requireUser);

  router.get('/', (req, res) => {
    res.json({ user: toMe(currentUser(req)) });
  });

  router.patch('/', async (req, res) => {
    const user = currentUser(req);
    const input = parse(profileSchema, req.body);
    if (input.username !== undefined && input.username !== user.username) {
      if (RESERVED.has(input.username)) {
        throw new HttpError(409, 'conflict', 'That username is taken.', { username: 'That username is taken.' });
      }
      user.username = input.username;
    }
    if (input.name !== undefined) user.name = input.name;
    if (input.bio !== undefined) user.bio = input.bio;
    if (!user.username || !user.name) {
      throw new HttpError(400, 'validation_failed', 'Pick a name and a username.', {
        ...(user.name ? {} : { name: 'Enter your name.' }),
        ...(user.username ? {} : { username: 'Pick a username.' }),
      });
    }
    try {
      await user.save();
    } catch (err) {
      if (isDuplicateKey(err)) {
        throw new HttpError(409, 'conflict', 'That username is taken.', { username: 'That username is taken.' });
      }
      throw err;
    }
    res.json({ user: toMe(user) });
  });

  router.put(
    '/avatar',
    express.raw({ type: [...AVATAR_TYPES], limit: LIMITS.avatarBytesMax }),
    async (req, res) => {
      const user = currentUser(req);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new HttpError(415, 'unsupported_media_type', 'Upload a PNG, JPEG, WebP or GIF image.');
      }
      const previous = user.avatar;
      user.avatar = await saveAvatar(deps.avatarsDir, user._id.toString(), req.body);
      await user.save();
      await deleteAvatar(deps.avatarsDir, previous);
      res.json({ user: toMe(user) });
    },
  );

  router.delete('/avatar', async (req, res) => {
    const user = currentUser(req);
    const previous = user.avatar;
    user.avatar = undefined;
    await user.save();
    await deleteAvatar(deps.avatarsDir, previous);
    res.json({ user: toMe(user) });
  });

  return router;
}
