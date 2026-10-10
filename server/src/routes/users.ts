import { Router, type Request } from 'express';
import type { Profile } from '@devsbooth/shared';
import { currentUser, requireOnboarded } from '../auth/middleware';
import { HttpError, notFound } from '../http/errors';
import { Follow } from '../models/follow';
import { User, type UserDoc } from '../models/user';
import type { Hub } from '../realtime/hub';
import { follows, listHostedRooms } from '../rooms/service';
import { avatarUrl } from '../users/dto';

async function findByUsername(req: Request): Promise<UserDoc> {
  const username = String(req.params.username ?? '').toLowerCase();
  const user = await User.findOne({ username });
  if (!user) throw notFound('No one has that username.');
  return user;
}

async function profileOf(user: UserDoc, viewer: UserDoc): Promise<Profile> {
  const [followers, following, isFollowing] = await Promise.all([
    Follow.countDocuments({ followee: user._id }),
    Follow.countDocuments({ follower: user._id }),
    follows(viewer._id, user._id),
  ]);
  return {
    id: user._id.toString(),
    username: user.username ?? '',
    name: user.name ?? '',
    avatarUrl: avatarUrl(user),
    bio: user.bio ?? '',
    followers,
    following,
    isFollowing,
    isMe: user._id.equals(viewer._id),
    createdAt: user.createdAt.toISOString(),
  };
}

export function userRoutes(hub: Hub) {
  const router = Router();
  router.use(requireOnboarded);

  router.get('/:username', async (req, res) => {
    const user = await findByUsername(req);
    res.json({ profile: await profileOf(user, currentUser(req)) });
  });

  router.get('/:username/rooms', async (req, res) => {
    const user = await findByUsername(req);
    res.json({ rooms: await listHostedRooms(user, currentUser(req), hub.countRooms) });
  });

  router.put('/:username/follow', async (req, res) => {
    const viewer = currentUser(req);
    const user = await findByUsername(req);
    if (user._id.equals(viewer._id)) throw new HttpError(400, 'bad_request', 'You cannot follow yourself.');
    await Follow.updateOne(
      { follower: viewer._id, followee: user._id },
      { $setOnInsert: { follower: viewer._id, followee: user._id } },
      { upsert: true },
    );
    res.json({ profile: await profileOf(user, viewer) });
  });

  router.delete('/:username/follow', async (req, res) => {
    const viewer = currentUser(req);
    const user = await findByUsername(req);
    await Follow.deleteOne({ follower: viewer._id, followee: user._id });
    res.json({ profile: await profileOf(user, viewer) });
  });

  return router;
}
