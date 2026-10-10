import { Router } from 'express';
import { z } from 'zod';
import { LIMITS, ROOM_TYPES } from '@devsbooth/shared';
import { currentUser, requireOnboarded } from '../auth/middleware';
import { forbidden, notFound, parse } from '../http/errors';
import type { Hub } from '../realtime/hub';
import { canEnter, createRoom, findLiveRoom, listRooms, setTopic, toRoomSummary } from '../rooms/service';

const topic = z
  .string({ error: 'Give the room a topic.' })
  .trim()
  .min(LIMITS.topicMin, { error: `Use at least ${LIMITS.topicMin} characters.` })
  .max(LIMITS.topicMax, { error: `Keep it under ${LIMITS.topicMax} characters.` });

const createSchema = z.object({
  topic,
  type: z.enum(ROOM_TYPES, { error: 'Pick open, social or private.' }),
});

const updateSchema = z.object({ topic });

const listSchema = z.object({ q: z.string().max(LIMITS.topicMax).optional() });

export function roomRoutes(hub: Hub) {
  const router = Router();
  router.use(requireOnboarded);

  router.get('/', async (req, res) => {
    const { q } = parse(listSchema, req.query);
    res.json({ rooms: await listRooms(currentUser(req), q ?? '', hub.countRooms) });
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

  router.patch('/:roomId', async (req, res) => {
    const room = await findLiveRoom(String(req.params.roomId));
    if (!room) throw notFound('This room has ended, or the link is wrong.');
    if (!room.owner._id.equals(currentUser(req)._id)) throw forbidden('Only the host can change this room.');
    const input = parse(updateSchema, req.body);
    if (!(await setTopic(room.publicId, input.topic))) throw notFound('This room has ended.');
    hub.roomUpdated(room.publicId, { topic: input.topic });
    res.json({ room: toRoomSummary({ ...room, topic: input.topic }, hub.count(room.publicId)) });
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
