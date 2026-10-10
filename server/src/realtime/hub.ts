import { parseCookie } from 'cookie';
import { Types } from 'mongoose';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type {
  ApiErrorCode,
  ClientToServerEvents,
  Participant,
  ParticipantPatch,
  ServerToClientEvents,
} from '@devsbooth/shared';
import { SESSION_COOKIE, findSession, hashToken, sessionIsActive } from '../auth/sessions';
import type { Config } from '../config';
import { log } from '../log';
import type { UserDoc } from '../models/user';
import {
  canEnter,
  findLiveRoom,
  isSpeaker,
  liveRoomIds,
  markEnded,
  setSpeaker,
  toRoomSummary,
} from '../rooms/service';
import { toSummary } from '../users/dto';
import { RoomLifecycle } from './lifecycle';
import { Presence } from './presence';

export interface SocketData {
  user: UserDoc;
  /** Hash of the session this socket signed in with, so logging out can disconnect it. */
  sessionHash: string;
}

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const joinSchema = z.object({ roomId: z.string().min(1).max(32) });

const signalSchema = z.union([
  z.object({
    to: z.string().min(1).max(64),
    description: z.object({
      type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
      sdp: z.string().max(50_000).optional(),
    }),
  }),
  z.object({
    to: z.string().min(1).max(64),
    candidate: z.object({
      candidate: z.string().max(2_000).optional(),
      sdpMid: z.string().max(64).nullable().optional(),
      sdpMLineIndex: z.number().int().min(0).max(1_000).nullable().optional(),
      usernameFragment: z.string().max(256).nullable().optional(),
    }),
  }),
]);

const roleSchema = z.object({ peerId: z.string().min(1).max(64), role: z.enum(['speaker', 'listener']) });

function fail(code: ApiErrorCode, message: string) {
  return { ok: false as const, error: { code, message } };
}

const channel = (roomId: string) => `room:${roomId}`;

export interface Hub {
  /** Live participant count for one room. */
  count(roomId: string): number;
  /** Live participant counts for a batch of rooms, for room lists. */
  countRooms(roomIds: string[]): Promise<Record<string, number>>;
  /** Starts the empty-room timer for a room nobody has joined yet. */
  roomCreated(roomId: string): void;
  /** Tells everyone in a room that its details changed. */
  roomUpdated(roomId: string, patch: { topic: string }): void;
  /** Ends a room in the database and sends everyone in it home. */
  endRoom(roomId: string): Promise<boolean>;
  /** After a restart nobody is connected, so every live room starts its empty-room timer. */
  scheduleIdleRooms(): Promise<void>;
  /** Disconnects every socket opened with this session, after logout. */
  dropSession(token: string): void;
  close(): void;
}

export function createHub(io: IoServer, config: Config): Hub {
  const presence = new Presence();
  /**
   * Rooms being ended, or ended in the last minute. A join that loaded the room before it was
   * marked ended checks this after its own awaits, so it cannot slip into a dead room.
   */
  const ending = new Set<string>();
  const lifecycle = new RoomLifecycle(config.room.emptyTtlMs, (roomId) => {
    endRoom(roomId).catch((err: unknown) => {
      log.error('Could not end idle room, will retry', { room: roomId, err });
      if (presence.count(roomId) === 0) lifecycle.vacant(roomId);
    });
  });

  async function endRoom(roomId: string): Promise<boolean> {
    ending.add(roomId);
    let ended: boolean;
    try {
      ended = await markEnded(roomId);
    } catch (err) {
      ending.delete(roomId);
      throw err;
    }
    lifecycle.occupied(roomId);
    io.to(channel(roomId)).emit('room:ended');
    presence.clear(roomId);
    io.in(channel(roomId)).socketsLeave(channel(roomId));
    setTimeout(() => ending.delete(roomId), 60_000).unref();
    if (ended) log.info('Room ended', { room: roomId });
    return ended;
  }

  function leave(socket: IoSocket): void {
    const left = presence.remove(socket.id);
    if (!left) return;
    void socket.leave(channel(left.roomId));
    socket.to(channel(left.roomId)).emit('peer:left', { peerId: socket.id });
    if (left.empty) lifecycle.vacant(left.roomId);
  }

  function broadcast(roomId: string, patch: ParticipantPatch): void {
    presence.update(patch);
    io.to(channel(roomId)).emit('peer:updated', patch);
  }

  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== config.appUrl.origin) return next(new Error('forbidden'));
      const token = parseCookie(socket.handshake.headers.cookie ?? '')[SESSION_COOKIE];
      const session = token ? await findSession(token) : null;
      if (!session) return next(new Error('unauthorized'));
      if (!session.user.username) return next(new Error('forbidden'));
      socket.data.user = session.user;
      socket.data.sessionHash = hashToken(token!);
      next();
    } catch (err) {
      log.error('Socket authentication failed', { err });
      next(new Error('internal'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const summary = toSummary(user);

    socket.on('room:join', async (payload, ack) => {
      if (typeof ack !== 'function') return;
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) return ack(fail('bad_request', 'That is not a room id.'));
      const { roomId } = parsed.data;

      try {
        leave(socket);
        // Sessions can expire while a socket stays open.
        if (!(await sessionIsActive(socket.data.sessionHash))) {
          ack(fail('unauthorized', 'Your session has ended. Sign in again to join.'));
          socket.disconnect(true);
          return;
        }
        const room = await findLiveRoom(roomId);
        if (!room) return ack(fail('room_ended', 'This room has ended, or the link is wrong.'));
        if (!(await canEnter(room, user))) {
          return ack(fail('forbidden', 'This is a social room. Follow the host to join it.'));
        }
        if (!socket.connected) return;

        // One seat per person: a second tab takes over from the first.
        for (const other of presence.peersOfUser(roomId, summary.id)) {
          io.to(other.peerId).emit('room:kicked', { reason: 'joined-elsewhere' });
          const otherSocket = io.sockets.sockets.get(other.peerId);
          if (otherSocket) leave(otherSocket);
          else presence.remove(other.peerId);
        }
        if (presence.count(roomId) >= config.room.maxParticipants) {
          return ack(fail('room_full', `This room is full (${config.room.maxParticipants} people).`));
        }

        const self: Participant = {
          peerId: socket.id,
          user: summary,
          role: isSpeaker(room, user._id) ? 'speaker' : 'listener',
          muted: true,
          handRaised: false,
        };
        // The host may have ended the room while this join was waiting on the database.
        if (ending.has(roomId)) return ack(fail('room_ended', 'This room has ended.'));
        const participants = presence.list(roomId);
        presence.add(roomId, self);
        lifecycle.occupied(roomId);
        await socket.join(channel(roomId));
        socket.to(channel(roomId)).emit('peer:joined', self);
        ack({ ok: true, room: toRoomSummary(room, presence.count(roomId)), self, participants });
      } catch (err) {
        log.error('Join failed', { room: roomId, err });
        ack(fail('internal', 'Could not join the room. Try again.'));
      }
    });

    socket.on('room:leave', () => leave(socket));
    socket.on('disconnect', () => leave(socket));

    socket.on('rtc:signal', (payload) => {
      const parsed = signalSchema.safeParse(payload);
      if (!parsed.success) return;
      const roomId = presence.roomOf(socket.id);
      const { to, ...signal } = parsed.data;
      // Only relay between two peers in the same room.
      if (!roomId || to === socket.id || presence.roomOf(to) !== roomId) return;
      io.to(to).emit('rtc:signal', { from: socket.id, ...signal });
    });

    socket.on('mic:set', (payload) => {
      const self = presence.get(socket.id);
      const roomId = presence.roomOf(socket.id);
      if (!self || !roomId || typeof payload?.muted !== 'boolean') return;
      // Listeners stay muted; promotion to speaker is the only way to talk.
      const muted = self.role === 'listener' ? true : payload.muted;
      if (self.muted === muted) return;
      broadcast(roomId, { peerId: socket.id, muted });
    });

    socket.on('hand:set', (payload) => {
      const self = presence.get(socket.id);
      const roomId = presence.roomOf(socket.id);
      if (!self || !roomId || self.role !== 'listener' || typeof payload?.raised !== 'boolean') return;
      if (self.handRaised === payload.raised) return;
      broadcast(roomId, { peerId: socket.id, handRaised: payload.raised });
    });

    socket.on('role:set', async (payload, ack) => {
      if (typeof ack !== 'function') return;
      const parsed = roleSchema.safeParse(payload);
      if (!parsed.success) return ack(fail('bad_request', 'Invalid role change.'));
      const { peerId, role } = parsed.data;

      try {
        const roomId = presence.roomOf(socket.id);
        const target = presence.get(peerId);
        if (!roomId || !target || presence.roomOf(peerId) !== roomId) {
          return ack(fail('not_found', 'That person is no longer in the room.'));
        }
        const room = await findLiveRoom(roomId);
        if (!room) return ack(fail('room_ended', 'This room has ended.'));
        if (!room.owner._id.equals(user._id)) {
          return ack(fail('forbidden', 'Only the host can change who speaks.'));
        }
        if (room.owner._id.toString() === target.user.id) {
          return ack(fail('bad_request', 'The host always speaks.'));
        }

        await setSpeaker(roomId, new Types.ObjectId(target.user.id), role === 'speaker');
        for (const peer of presence.peersOfUser(roomId, target.user.id)) {
          broadcast(roomId, { peerId: peer.peerId, role, handRaised: false, muted: true });
        }
        ack({ ok: true });
      } catch (err) {
        log.error('Role change failed', { err });
        ack(fail('internal', 'Could not change the role. Try again.'));
      }
    });
  });

  return {
    count: (roomId) => presence.count(roomId),
    countRooms: async (roomIds) => Object.fromEntries(roomIds.map((id) => [id, presence.count(id)])),
    roomCreated: (roomId) => lifecycle.vacant(roomId),
    roomUpdated: (roomId, patch) => {
      io.to(channel(roomId)).emit('room:updated', patch);
    },
    endRoom,
    async scheduleIdleRooms() {
      for (const roomId of await liveRoomIds()) {
        if (presence.count(roomId) === 0) lifecycle.vacant(roomId);
      }
    },
    dropSession(token) {
      const hash = hashToken(token);
      for (const socket of io.sockets.sockets.values()) {
        if (socket.data.sessionHash === hash) socket.disconnect(true);
      }
    },
    close: () => lifecycle.dispose(),
  };
}
