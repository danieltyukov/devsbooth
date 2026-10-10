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
  UserSummary,
} from '@devsbooth/shared';
import { SESSION_COOKIE, findSession, hashToken, sessionIsActive } from '../auth/sessions';
import type { Config } from '../config';
import { log } from '../log';
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
import type { SfuGateway } from '../media/sfu';
import type { PresenceStore } from './presence';

/**
 * Plain values only: with several processes, Socket.IO serializes this to answer fetchSockets().
 */
export interface SocketData {
  userId: string;
  summary: UserSummary;
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
/** Every socket of one session joins this, so logout can reach them on any process at once. */
const sessionChannel = (sessionHash: string) => `session:${sessionHash}`;
/** How often an open socket re-checks that its session still exists. */
const SESSION_CHECK_MS = 60_000;

/** How long a room stays marked as ending, so joins that started before it ended are refused. */
const ENDING_MS = 60_000;
/** How often to look for rooms left without an empty-room timer, when presence is shared. */
const IDLE_CHECK_MS = 60_000;

export interface Hub {
  /** Live participant count for one room. */
  count(roomId: string): Promise<number>;
  /** Live participant counts for a batch of rooms, for room lists. */
  countRooms(roomIds: string[]): Promise<Record<string, number>>;
  /** Starts the empty-room timer for a room nobody has joined yet. */
  roomCreated(roomId: string): void;
  /** Tells everyone in a room that its details changed. */
  roomUpdated(roomId: string, patch: { topic: string }): void;
  /** Ends a room in the database and sends everyone in it home. */
  endRoom(roomId: string): Promise<boolean>;
  /** After a restart nobody is connected, so every empty live room starts its timer. */
  scheduleIdleRooms(): Promise<void>;
  /** Disconnects every socket opened with this session, on any process, after logout. */
  dropSession(token: string): Promise<void>;
  /**
   * Takes this process's peers out of their rooms and tells the rooms, while the other processes
   * can still hear it. Call before closing Socket.IO; later events are ignored.
   */
  shutdown(): Promise<void>;
}

export interface HubOptions {
  /** How often to sweep participants of stopped processes, when presence is shared. */
  sweepMs?: number;
  /** Carries audio through an SFU instead of the browser mesh. */
  sfu?: SfuGateway | null;
}

export function createHub(
  io: IoServer,
  config: Config,
  presence: PresenceStore,
  options: HubOptions = {},
): Hub {
  const sfu = options.sfu ?? null;
  const lifecycle = new RoomLifecycle(config.room.emptyTtlMs, (roomId) => {
    expire(roomId).catch((err: unknown) => {
      log.error('Could not end idle room, will retry', { room: roomId, err });
      lifecycle.ensure(roomId);
    });
  });
  const timers: NodeJS.Timeout[] = [];
  let closing = false;
  /** Each socket's queue of event handlers, so shutdown can wait for work in flight. */
  const queues = new Map<string, Promise<void>>();
  /** Peers this process put into presence, so shutdown can take all of them out. */
  const localPeers = new Set<string>();

  /** Ends an idle room, unless someone joined it, possibly through another process. */
  async function expire(roomId: string): Promise<void> {
    if ((await presence.count(roomId)) > 0) return;
    await endRoom(roomId);
  }

  async function endRoom(roomId: string): Promise<boolean> {
    await presence.markEnding(roomId, ENDING_MS);
    let ended: boolean;
    try {
      ended = await markEnded(roomId);
    } catch (err) {
      await presence.unmarkEnding(roomId);
      throw err;
    }
    lifecycle.occupied(roomId);
    io.to(channel(roomId)).emit('room:ended');
    await presence.clear(roomId);
    io.in(channel(roomId)).socketsLeave(channel(roomId));
    await sfu?.closeRoom(roomId);
    if (ended) log.info('Room ended', { room: roomId });
    return ended;
  }

  /** Takes a peer out of its room, wherever its socket lives, and tells the rest of the room. */
  async function evict(peerId: string): Promise<void> {
    localPeers.delete(peerId);
    const left = await presence.remove(peerId);
    if (!left) return;
    io.in(peerId).socketsLeave(channel(left.roomId));
    io.to(channel(left.roomId)).except(peerId).emit('peer:left', { peerId });
    if (left.empty) lifecycle.vacant(left.roomId);
  }

  async function broadcast(roomId: string, patch: ParticipantPatch): Promise<void> {
    if (!(await presence.update(patch))) return;
    io.to(channel(roomId)).emit('peer:updated', patch);
  }

  if (presence.shared) {
    // Participants of a process that stopped without saying goodbye.
    const sweep = setInterval(() => {
      presence
        .sweep()
        .then((removals) => {
          for (const { roomId, participant, empty } of removals) {
            io.to(channel(roomId)).emit('peer:left', { peerId: participant.peerId });
            if (empty) lifecycle.vacant(roomId);
          }
        })
        .catch((err: unknown) => log.warn('Presence sweep failed', { err }));
    }, options.sweepMs ?? 5_000);
    // A process that stopped also took its empty-room timers with it.
    const idle = setInterval(() => {
      scheduleIdleRooms().catch((err: unknown) => log.warn('Idle room check failed', { err }));
    }, IDLE_CHECK_MS);
    for (const timer of [sweep, idle]) {
      timer.unref();
      timers.push(timer);
    }
  }

  async function scheduleIdleRooms(): Promise<void> {
    const ids = await liveRoomIds();
    const counts = await presence.counts(ids);
    for (const roomId of ids) {
      if ((counts[roomId] ?? 0) === 0) lifecycle.ensure(roomId);
    }
  }

  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== config.appUrl.origin) return next(new Error('forbidden'));
      const token = parseCookie(socket.handshake.headers.cookie ?? '')[SESSION_COOKIE];
      const session = token ? await findSession(token) : null;
      if (!token || !session) return next(new Error('unauthorized'));
      if (!session.user.username) return next(new Error('forbidden'));
      socket.data.userId = session.user._id.toString();
      socket.data.summary = toSummary(session.user);
      socket.data.sessionHash = hashToken(token);
      next();
    } catch (err) {
      log.error('Socket authentication failed', { err });
      next(new Error('internal'));
    }
  });

  io.on('connection', (socket: IoSocket) => {
    const userId = new Types.ObjectId(socket.data.userId);
    const summary = socket.data.summary;
    void socket.join(sessionChannel(socket.data.sessionHash));

    /** Disconnects the socket if its session ended (logout, expiry) and reports whether it did. */
    const sessionEnded = async (): Promise<boolean> => {
      if (await sessionIsActive(socket.data.sessionHash)) return false;
      socket.disconnect(true);
      return true;
    };
    // Expiry, or a logout broadcast this process missed, still ends the socket within a minute.
    const sessionCheck = setInterval(() => {
      sessionEnded().catch((err: unknown) => log.warn('Session check failed', { err }));
    }, SESSION_CHECK_MS);
    sessionCheck.unref();
    socket.on('disconnect', () => clearInterval(sessionCheck));

    // Presence calls are async, so a socket's events run one at a time, in the order they came:
    // two quick mute toggles cannot read the same stale state, and an offer stays ahead of its
    // ICE candidates.
    const inOrder =
      <A extends unknown[]>(handler: (...args: A) => Promise<void>) =>
      (...args: A) => {
        const queue = (queues.get(socket.id) ?? Promise.resolve())
          .then(() => (closing ? undefined : handler(...args)))
          .catch((err: unknown) => log.error('Socket handler failed', { err }));
        queues.set(socket.id, queue);
        void queue.then(() => {
          if (queues.get(socket.id) === queue) queues.delete(socket.id);
        });
      };

    socket.on(
      'room:join',
      inOrder(async (payload, ack) => {
        if (typeof ack !== 'function') return;
        const parsed = joinSchema.safeParse(payload);
        if (!parsed.success) return ack(fail('bad_request', 'That is not a room id.'));
        const { roomId } = parsed.data;

        try {
          await evict(socket.id);
          // Sessions can expire while a socket stays open.
          if (!(await sessionIsActive(socket.data.sessionHash))) {
            ack(fail('unauthorized', 'Your session has ended. Sign in again to join.'));
            socket.disconnect(true);
            return;
          }
          const room = await findLiveRoom(roomId);
          if (!room) return ack(fail('room_ended', 'This room has ended, or the link is wrong.'));
          if (!(await canEnter(room, userId))) {
            return ack(fail('forbidden', 'This is a social room. Follow the host to join it.'));
          }

          // One seat per person: a second tab, on any process, takes over from the first.
          for (const other of await presence.peersOfUser(roomId, summary.id)) {
            io.to(other.peerId).emit('room:kicked', { reason: 'joined-elsewhere' });
            await evict(other.peerId);
            await sfu?.removePeer(roomId, other.peerId);
          }
          if (!socket.connected) return;

          const self: Participant = {
            peerId: socket.id,
            user: summary,
            role: isSpeaker(room, userId) ? 'speaker' : 'listener',
            muted: true,
            handRaised: false,
          };
          // Capacity and the ending marker are checked in the same step as the add, so concurrent
          // joins, on this process or another, cannot overfill a room or slip into one being ended.
          const result = await presence.join(roomId, self, config.room.maxParticipants);
          if (result === 'full') {
            return ack(fail('room_full', `This room is full (${config.room.maxParticipants} people).`));
          }
          if (result === 'ending') return ack(fail('room_ended', 'This room has ended.'));
          localPeers.add(socket.id);
          if (!socket.connected) {
            await evict(socket.id);
            return;
          }
          const participants = (await presence.list(roomId)).filter((p) => p.peerId !== socket.id);
          lifecycle.occupied(roomId);
          await socket.join(channel(roomId));
          socket.to(channel(roomId)).emit('peer:joined', self);
          const sfuToken = sfu
            ? await sfu.token({
                roomId,
                peerId: socket.id,
                name: summary.name,
                canPublish: self.role === 'speaker',
              })
            : undefined;
          ack({
            ok: true,
            room: toRoomSummary(room, participants.length + 1),
            self,
            participants,
            ...(sfuToken ? { sfuToken } : {}),
          });
        } catch (err) {
          log.error('Join failed', { room: roomId, err });
          ack(fail('internal', 'Could not join the room. Try again.'));
        }
      }),
    );

    socket.on(
      'room:leave',
      inOrder(() => evict(socket.id)),
    );
    socket.on(
      'disconnect',
      inOrder(() => evict(socket.id)),
    );

    socket.on(
      'rtc:signal',
      inOrder(async (payload) => {
        const parsed = signalSchema.safeParse(payload);
        if (!parsed.success) return;
        const { to, ...signal } = parsed.data;
        if (to === socket.id) return;
        const [mine, theirs] = await Promise.all([presence.roomOf(socket.id), presence.roomOf(to)]);
        // Only relay between two peers in the same room.
        if (!mine || mine !== theirs) return;
        io.to(to).emit('rtc:signal', { from: socket.id, ...signal });
      }),
    );

    socket.on(
      'mic:set',
      inOrder(async (payload) => {
        if (typeof payload?.muted !== 'boolean') return;
        const [self, roomId] = await Promise.all([presence.get(socket.id), presence.roomOf(socket.id)]);
        if (!self || !roomId) return;
        // Listeners stay muted; promotion to speaker is the only way to talk.
        const muted = self.role === 'listener' ? true : payload.muted;
        if (self.muted === muted) return;
        await broadcast(roomId, { peerId: socket.id, muted });
      }),
    );

    socket.on(
      'hand:set',
      inOrder(async (payload) => {
        if (typeof payload?.raised !== 'boolean') return;
        const [self, roomId] = await Promise.all([presence.get(socket.id), presence.roomOf(socket.id)]);
        if (!self || !roomId || self.role !== 'listener' || self.handRaised === payload.raised) return;
        await broadcast(roomId, { peerId: socket.id, handRaised: payload.raised });
      }),
    );

    socket.on(
      'role:set',
      inOrder(async (payload, ack) => {
        if (typeof ack !== 'function') return;
        const parsed = roleSchema.safeParse(payload);
        if (!parsed.success) return ack(fail('bad_request', 'Invalid role change.'));
        const { peerId, role } = parsed.data;

        try {
          // Host controls need a live session, not just a socket that was opened with one.
          if (await sessionEnded()) return;
          const [roomId, targetRoom, target] = await Promise.all([
            presence.roomOf(socket.id),
            presence.roomOf(peerId),
            presence.get(peerId),
          ]);
          if (!roomId || !target || targetRoom !== roomId) {
            return ack(fail('not_found', 'That person is no longer in the room.'));
          }
          const room = await findLiveRoom(roomId);
          if (!room) return ack(fail('room_ended', 'This room has ended.'));
          if (!room.owner._id.equals(userId)) {
            return ack(fail('forbidden', 'Only the host can change who speaks.'));
          }
          if (room.owner._id.toString() === target.user.id) {
            return ack(fail('bad_request', 'The host always speaks.'));
          }

          await setSpeaker(roomId, new Types.ObjectId(target.user.id), role === 'speaker');
          for (const peer of await presence.peersOfUser(roomId, target.user.id)) {
            if (sfu) {
              // The SFU enforces the role: change the permission before anyone hears about it, and
              // hand the person a token for the new role in case they are not connected to it yet.
              const canPublish = role === 'speaker';
              await sfu.setCanPublish(roomId, peer.peerId, canPublish);
              const token = await sfu.token({
                roomId,
                peerId: peer.peerId,
                name: peer.user.name,
                canPublish,
              });
              io.to(peer.peerId).emit('media:token', { token });
            }
            await broadcast(roomId, { peerId: peer.peerId, role, handRaised: false, muted: true });
          }
          ack({ ok: true });
        } catch (err) {
          log.error('Role change failed', { err });
          ack(fail('internal', 'Could not change the role. Try again.'));
        }
      }),
    );
  });

  return {
    count: (roomId) => presence.count(roomId),
    countRooms: (roomIds) => presence.counts(roomIds),
    roomCreated: (roomId) => lifecycle.vacant(roomId),
    roomUpdated: (roomId, patch) => {
      io.to(channel(roomId)).emit('room:updated', patch);
    },
    endRoom,
    scheduleIdleRooms,
    async dropSession(token) {
      // A broadcast through the adapter: it does not wait for every process to answer, so one
      // slow process cannot leave a logged-out socket connected.
      io.in(sessionChannel(hashToken(token))).disconnectSockets(true);
    },
    async shutdown() {
      if (closing) return;
      closing = true;
      for (const timer of timers) clearInterval(timer);
      lifecycle.dispose();
      // Let handlers already running finish while Redis and the adapter are still open.
      await Promise.allSettled([...queues.values()]);
      // Then take out every peer this process added, including sockets that already went away
      // but whose disconnect handler had not run yet.
      for (const peerId of [...localPeers]) {
        await evict(peerId).catch((err: unknown) => log.warn('Could not remove a peer on shutdown', { err }));
      }
    },
  };
}
