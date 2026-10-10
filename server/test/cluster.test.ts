import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomSummary } from '@devsbooth/shared';
import { Redis } from 'ioredis';
import { redisBackend } from '../src/realtime/backend';
import { RedisPresence } from '../src/realtime/redis-presence';
import { emitWithAck, next, startTestApp, type TestApp, type TestNode } from './helpers';

/** Set to run, e.g. TEST_REDIS_URL=redis://localhost:6379 */
const redisUrl = process.env.TEST_REDIS_URL;

// Two server processes, A and B, sharing MongoDB and Redis. People connect to either one.
describe.skipIf(!redisUrl)('several server processes', () => {
  let a: TestApp;
  let b: TestNode;
  let host: { cookie: string };
  let guest: { cookie: string };
  const prefix = `test:${randomBytes(4).toString('hex')}:`;

  beforeAll(async () => {
    a = await startTestApp(
      { ROOM_MAX_PARTICIPANTS: '4' },
      {
        backend: () => redisBackend(redisUrl!, { prefix, heartbeatMs: 200, heartbeatTtlMs: 600 }),
        hub: { sweepMs: 200 },
      },
    );
    b = await a.addNode();
    host = await a.createUser('cl_host');
    guest = await a.createUser('cl_guest');
  });
  afterAll(async () => {
    await a.close();
  });

  async function createRoom(): Promise<RoomSummary> {
    const res = await a.http
      .post('/api/rooms')
      .set('Cookie', host.cookie)
      .send({ topic: 'Clustered', type: 'open' });
    return res.body.room as RoomSummary;
  }

  it('puts people on different processes in the same room', async () => {
    const room = await createRoom();
    const onA = await a.socket(host.cookie);
    const onB = await b.socket(guest.cookie);
    const ja = await emitWithAck(onA, 'room:join', { roomId: room.id });
    if (!ja.ok) throw new Error('join failed');

    const joined = next(onA, 'peer:joined');
    const jb = await emitWithAck(onB, 'room:join', { roomId: room.id });
    if (!jb.ok) throw new Error('join failed');
    expect(jb.participants.map((p) => p.user.username)).toEqual(['cl_host']);
    expect((await joined).user.username).toBe('cl_guest');

    // Counts are shared: either process reports both people.
    const listed = await b.http.get('/api/rooms').set('Cookie', guest.cookie).expect(200);
    expect((listed.body.rooms as RoomSummary[]).find((r) => r.id === room.id)?.participantCount).toBe(2);

    // Signaling crosses processes.
    const offer = next(onA, 'rtc:signal');
    onB.emit('rtc:signal', { to: ja.self.peerId, description: { type: 'offer', sdp: 'v=0' } });
    expect(await offer).toEqual({ from: jb.self.peerId, description: { type: 'offer', sdp: 'v=0' } });

    // So do state changes and the host's controls.
    const raised = next(onA, 'peer:updated');
    onB.emit('hand:set', { raised: true });
    expect(await raised).toEqual({ peerId: jb.self.peerId, handRaised: true });
    const promoted = next(onB, 'peer:updated');
    expect(await emitWithAck(onA, 'role:set', { peerId: jb.self.peerId, role: 'speaker' })).toEqual({
      ok: true,
    });
    expect(await promoted).toMatchObject({ peerId: jb.self.peerId, role: 'speaker' });

    const left = next(onA, 'peer:left');
    onB.emit('room:leave');
    expect((await left).peerId).toBe(jb.self.peerId);
  });

  it('moves a person to their newest tab on another process', async () => {
    const room = await createRoom();
    const first = await a.socket(guest.cookie);
    await emitWithAck(first, 'room:join', { roomId: room.id });
    const kicked = next(first, 'room:kicked');
    const second = await b.socket(guest.cookie);
    const joined = await emitWithAck(second, 'room:join', { roomId: room.id });
    expect(joined.ok).toBe(true);
    expect(await kicked).toEqual({ reason: 'joined-elsewhere' });
    expect(await b.instance.hub.count(room.id)).toBe(1);
  });

  it('ends a room for everyone, wherever they are connected', async () => {
    const room = await createRoom();
    const onA = await a.socket(host.cookie);
    const onB = await b.socket(guest.cookie);
    await emitWithAck(onA, 'room:join', { roomId: room.id });
    await emitWithAck(onB, 'room:join', { roomId: room.id });
    const endedA = next(onA, 'room:ended');
    const endedB = next(onB, 'room:ended');
    await b.http.delete(`/api/rooms/${room.id}`).set('Cookie', host.cookie).expect(204);
    await Promise.all([endedA, endedB]);
    expect(await a.instance.hub.count(room.id)).toBe(0);
  });

  it('never overfills a room when people join through different processes at once', async () => {
    const room = await createRoom();
    const people = await Promise.all(Array.from({ length: 6 }, (_, i) => a.createUser(`cl_crowd${i}`)));
    const sockets = await Promise.all(people.map((p, i) => (i % 2 ? b : a).socket(p.cookie)));
    const capped = await Promise.all(sockets.map((s) => emitWithAck(s, 'room:join', { roomId: room.id })));
    const admitted = capped.filter((result) => result.ok).length;
    expect(admitted).toBeLessThanOrEqual(4);
    expect(await a.instance.hub.count(room.id)).toBe(admitted);
  });

  it('disconnects a session on every process when it logs out', async () => {
    const leaving = await a.createUser('cl_leaving');
    const onB = await b.socket(leaving.cookie);
    const disconnected = new Promise<string>((resolve) => onB.once('disconnect', resolve));
    await a.http.post('/api/auth/logout').set('Cookie', leaving.cookie).expect(204);
    expect(await disconnected).toBe('io server disconnect');
  });

  it('tells the room when a process goes away', async () => {
    const room = await createRoom();
    const c = await a.addNode();
    const onA = await a.socket(host.cookie);
    const onC = await c.socket(guest.cookie);
    await emitWithAck(onA, 'room:join', { roomId: room.id });
    const jc = await emitWithAck(onC, 'room:join', { roomId: room.id });
    if (!jc.ok) throw new Error('join failed');

    const left = next(onA, 'peer:left', 5_000);
    await c.close();
    expect((await left).peerId).toBe(jc.self.peerId);
    expect(await a.instance.hub.count(room.id)).toBe(1);
  });

  it('tells the room when a process crashes', async () => {
    const room = await createRoom();
    const onA = await a.socket(host.cookie);
    await emitWithAck(onA, 'room:join', { roomId: room.id });

    // A process that registered a participant, then died without a word.
    const crashing = new Redis(redisUrl!);
    const dead = await RedisPresence.create(crashing, { prefix, heartbeatMs: 100, heartbeatTtlMs: 300 });
    const ghost = {
      peerId: 'ghost-peer',
      user: { id: 'ghost', username: 'ghost', name: 'Ghost', avatarUrl: null },
      role: 'listener' as const,
      muted: true,
      handRaised: false,
    };
    await dead.add(room.id, ghost);
    crashing.disconnect();
    expect(await a.instance.hub.count(room.id)).toBe(2);

    const left = next(onA, 'peer:left', 5_000);
    expect(await left).toEqual({ peerId: 'ghost-peer' });
    expect(await a.instance.hub.count(room.id)).toBe(1);
    await dead.close().catch(() => {});
  });
});
