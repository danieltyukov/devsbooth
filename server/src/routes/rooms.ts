import { Router } from 'express';
import { z } from 'zod';
import { LIMITS, ROOM_TYPES } from '@devsbooth/shared';
import { currentUser, requireOnboarded } from '../auth/middleware';
import { forbidden, notFound, parse } from '../http/errors';
import type { Hub } from '../realtime/hub';
import { canEnter, createRoom, findLiveRoom, listRooms, toRoomSummary } from '../rooms/service';

const createSchema = z.object({
  topic: z
    .string({ error: 'Give the room a topic.' })
    .trim()
    .min(LIMITS.topicMin, { error: `Use at least ${LIMITS.topicMin} characters.` })
    .max(LIMITS.topicMax, { error: `Keep it under ${LIMITS.topicMax} characters.` }),
  type: z.enum(ROOM_TYPES, { error: 'Pick open, social or private.' }),
});

const listSchema = z.object({ q: z.string().max(LIMITS.topicMax).optional() });

export function roomRoutes(hub: Hub) {
  const router = Router();
  router.use(requireOnboarded);

  router.get('/', async (req, res) => {
    const { q } = parse(listSchema, req.query);
    res.json({ rooms: await listRooms(currentUser(req), q ?? '', hub.count) });
  });

  router.post('/', async (req, res) => {
    const input = parse(createSchema, req.body);
    const roomId = await createRoom(currentUser(req), input);
    hub.roomCreated(roomId);
    const room = await findLiveRoom(roomId);
    res.status(201).json({ room: toRoomSummary(room!, 0) });
  });

  router.get('/:roomId', async (req, res) => {
    const room = await findLiveRoom(String(req.params.roomId));
    if (!room) throw notFound('This room has ended, or the link is wrong.');
    if (!(await canEnter(room, currentUser(req)))) {
      throw forbidden('This is a social room. Follow the host to join it.');
    }
    res.json({ room: toRoomSummary(room, hub.count(room.publicId)) });
  });

  router.delete('/:roomId', async (req, res) => {
    const room = await findLiveRoom(String(req.params.roomId));
    if (!room) throw notFound('This room has already ended.');
    if (!room.owner._id.equals(currentUser(req)._id)) throw forbidden('Only the host can end this room.');
    await hub.endRoom(room.publicId);
    res.status(204).end();
  });

  return router;
}
