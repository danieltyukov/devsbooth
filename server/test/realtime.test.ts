import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomSummary } from '@devsbooth/shared';
import { Room } from '../src/models/room';
import { emitWithAck, next, sleep, startTestApp, type TestApp } from './helpers';

let t: TestApp;
let host: { cookie: string };
let guest: { cookie: string };
let third: { cookie: string };

beforeAll(async () => {
  t = await startTestApp({ ROOM_MAX_PARTICIPANTS: '3' });
  host = await t.createUser('rt_host');
  guest = await t.createUser('rt_guest');
  third = await t.createUser('rt_third');
});
afterAll(async () => {
  await t.close();
});

async function createRoom(type = 'open', cookie = host.cookie): Promise<RoomSummary> {
  const res = await t.http
    .post('/api/rooms')
    .set('Cookie', cookie)
    .send({ topic: 'Realtime', type })
    .expect(201);
  return res.body.room as RoomSummary;
}

describe('socket authentication', () => {
  it('rejects connections without a session', async () => {
    await expect(t.socket('devsbooth_session=nope')).rejects.toThrow(/unauthorized/);
  });

  it('rejects users who have not finished onboarding', async () => {
    const cookie = await t.signIn('half@example.com');
    await expect(t.socket(cookie)).rejects.toThrow(/forbidden/);
  });
});

describe('joining a room', () => {
  it('gives the newcomer the current participants and announces them to the rest', async () => {
    const room = await createRoom();
    const a = await t.socket(host.cookie);
    const joinedA = await emitWithAck(a, 'room:join', { roomId: room.id });
    expect(joinedA).toMatchObject({ ok: true, participants: [] });
    if (!joinedA.ok) throw new Error('join failed');
    expect(joinedA.self).toMatchObject({ role: 'speaker', muted: true, handRaised: false });

    const b = await t.socket(guest.cookie);
    const announced = next(a, 'peer:joined');
    const joinedB = await emitWithAck(b, 'room:join', { roomId: room.id });
    if (!joinedB.ok) throw new Error('join failed');
    expect(joinedB.self.role).toBe('listener');
    expect(joinedB.participants.map((p) => p.user.username)).toEqual(['rt_host']);
    expect(joinedB.room.participantCount).toBe(2);
    expect((await announced).user.username).toBe('rt_guest');

    const listed = await t.http.get('/api/rooms').set('Cookie', third.cookie).expect(200);
    const summary = (listed.body.rooms as RoomSummary[]).find((r) => r.id === room.id);
    expect(summary?.participantCount).toBe(2);

    const left = next(a, 'peer:left');
    b.emit('room:leave');
    expect((await left).peerId).toBe(joinedB.self.peerId);
  });

  it('relays signaling only between peers in the same room', async () => {
    const room = await createRoom();
    const a = await t.socket(host.cookie);
    const b = await t.socket(guest.cookie);
    const ja = await emitWithAck(a, 'room:join', { roomId: room.id });
    await emitWithAck(b, 'room:join', { roomId: room.id });
    if (!ja.ok) throw new Error('join failed');

    const offer = next(a, 'rtc:signal');
    b.emit('rtc:signal', { to: ja.self.peerId, description: { type: 'offer', sdp: 'v=0' } });
    expect(await offer).toEqual({ from: b.id, description: { type: 'offer', sdp: 'v=0' } });

    const outsider = await t.socket(third.cookie);
    let leaked = false;
    a.once('rtc:signal', () => {
      leaked = true;
    });
    outsider.emit('rtc:signal', { to: ja.self.peerId, candidate: { candidate: 'x' } });
    await sleep(200);
    expect(leaked).toBe(false);
  });

  it('refuses ended rooms, social rooms for non-followers, and full rooms', async () => {
    const s = await t.socket(third.cookie);
    const missing = await emitWithAck(s, 'room:join', { roomId: 'nothinghere' });
    expect(missing).toMatchObject({ ok: false, error: { code: 'room_ended' } });

    const social = await createRoom('social');
    const denied = await emitWithAck(s, 'room:join', { roomId: social.id });
    expect(denied).toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const room = await createRoom();
    const others = [
      await t.socket(host.cookie),
      await t.socket(guest.cookie),
      await t.socket(
        await t.signIn('rt_extra@example.com').then(async (cookie) => {
          await t.http
            .patch('/api/me')
            .set('Cookie', cookie)
            .send({ name: 'Extra', username: 'rt_extra' })
            .expect(200);
          return cookie;
        }),
      ),
    ];
    for (const socket of others) {
      expect((await emitWithAck(socket, 'room:join', { roomId: room.id })).ok).toBe(true);
    }
    const full = await emitWithAck(s, 'room:join', { roomId: room.id });
    expect(full).toMatchObject({ ok: false, error: { code: 'room_full' } });
  });

  it('moves a user to their newest tab', async () => {
    const room = await createRoom();
    const watcher = await t.socket(host.cookie);
    await emitWithAck(watcher, 'room:join', { roomId: room.id });
    const first = await t.socket(guest.cookie);
    await emitWithAck(first, 'room:join', { roomId: room.id });

    const kicked = next(first, 'room:kicked');
    const second = await t.socket(guest.cookie);
    const joined = await emitWithAck(second, 'room:join', { roomId: room.id });
    expect(await kicked).toEqual({ reason: 'joined-elsewhere' });
    if (!joined.ok) throw new Error('join failed');
    expect(joined.participants.map((p) => p.user.username)).toEqual(['rt_host']);
  });
});

describe('roles and state', () => {
  it('keeps listeners muted, lets speakers unmute, and lets listeners raise a hand', async () => {
    const room = await createRoom();
    const a = await t.socket(host.cookie);
    const b = await t.socket(guest.cookie);
    const ja = await emitWithAck(a, 'room:join', { roomId: room.id });
    const jb = await emitWithAck(b, 'room:join', { roomId: room.id });
    if (!ja.ok || !jb.ok) throw new Error('join failed');

    let update = next(b, 'peer:updated');
    a.emit('mic:set', { muted: false });
    expect(await update).toEqual({ peerId: ja.self.peerId, muted: false });

    let listenerUpdate = false;
    a.once('peer:updated', () => {
      listenerUpdate = true;
    });
    b.emit('mic:set', { muted: false });
    await sleep(200);
    expect(listenerUpdate).toBe(false);

    update = next(a, 'peer:updated');
    b.emit('hand:set', { raised: true });
    expect(await update).toEqual({ peerId: jb.self.peerId, handRaised: true });
  });

  it('lets only the host promote and demote, and remembers speakers', async () => {
    const room = await createRoom();
    const a = await t.socket(host.cookie);
    const b = await t.socket(guest.cookie);
    const ja = await emitWithAck(a, 'room:join', { roomId: room.id });
    const jb = await emitWithAck(b, 'room:join', { roomId: room.id });
    if (!ja.ok || !jb.ok) throw new Error('join failed');

    const notHost = await emitWithAck(b, 'role:set', { peerId: ja.self.peerId, role: 'listener' });
    expect(notHost).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const hostStays = await emitWithAck(a, 'role:set', { peerId: ja.self.peerId, role: 'listener' });
    expect(hostStays).toMatchObject({ ok: false, error: { code: 'bad_request' } });

    const promoted = next(b, 'peer:updated');
    expect(await emitWithAck(a, 'role:set', { peerId: jb.self.peerId, role: 'speaker' })).toEqual({
      ok: true,
    });
    expect(await promoted).toEqual({
      peerId: jb.self.peerId,
      role: 'speaker',
      handRaised: false,
      muted: true,
    });

    const stored = await Room.findOne({ publicId: room.id }).lean();
    expect(stored?.speakers.map(String)).toContain(jb.self.user.id);

    // A promoted guest who rejoins is still a speaker.
    b.emit('room:leave');
    const rejoin = await emitWithAck(b, 'room:join', { roomId: room.id });
    expect(rejoin).toMatchObject({ ok: true, self: { role: 'speaker' } });
    if (!rejoin.ok) throw new Error('join failed');

    const demoted = next(b, 'peer:updated');
    await emitWithAck(a, 'role:set', { peerId: rejoin.self.peerId, role: 'listener' });
    expect(await demoted).toMatchObject({ role: 'listener', muted: true });
  });
});

describe('ending rooms', () => {
  it('sends everyone home when the host ends the room', async () => {
    const room = await createRoom();
    const b = await t.socket(guest.cookie);
    await emitWithAck(b, 'room:join', { roomId: room.id });
    const ended = next(b, 'room:ended');
    await t.http.delete(`/api/rooms/${room.id}`).set('Cookie', host.cookie).expect(204);
    await ended;
  });
});

describe('idle rooms', () => {
  let idle: TestApp;
  beforeAll(async () => {
    await t.close();
    idle = await startTestApp({ ROOM_EMPTY_TTL: '1' });
    t = idle;
  });

  it('ends a room that stays empty past the timeout', async () => {
    const owner = await idle.createUser('idle_host');
    const res = await idle.http
      .post('/api/rooms')
      .set('Cookie', owner.cookie)
      .send({ topic: 'Nobody came', type: 'open' })
      .expect(201);
    const roomId: string = res.body.room.id;

    const s = await idle.socket(owner.cookie);
    await emitWithAck(s, 'room:join', { roomId });
    await sleep(1_300);
    await idle.http.get(`/api/rooms/${roomId}`).set('Cookie', owner.cookie).expect(200);

    s.emit('room:leave');
    await sleep(1_500);
    await idle.http.get(`/api/rooms/${roomId}`).set('Cookie', owner.cookie).expect(404);
  });
});
