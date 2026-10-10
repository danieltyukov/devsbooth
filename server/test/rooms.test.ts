import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomSummary } from '@devsbooth/shared';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;
let host: { cookie: string };
let follower: { cookie: string };
let stranger: { cookie: string };

beforeAll(async () => {
  t = await startTestApp();
  host = await t.createUser('host');
  follower = await t.createUser('follower');
  stranger = await t.createUser('stranger');
  await t.http.put('/api/users/host/follow').set('Cookie', follower.cookie).expect(200);
});
afterAll(async () => {
  await t.close();
});

async function create(topic: string, type: string, cookie = host.cookie): Promise<RoomSummary> {
  const res = await t.http.post('/api/rooms').set('Cookie', cookie).send({ topic, type }).expect(201);
  return res.body.room as RoomSummary;
}

async function list(cookie: string, q?: string): Promise<string[]> {
  const res = await t.http
    .get('/api/rooms')
    .query(q ? { q } : {})
    .set('Cookie', cookie)
    .expect(200);
  return (res.body.rooms as RoomSummary[]).map((room) => room.topic);
}

describe('rooms', () => {
  it('creates a room with the owner as the first speaker', async () => {
    const room = await create('Rust async runtimes', 'open');
    expect(room.id).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(room).toMatchObject({ topic: 'Rust async runtimes', type: 'open', participantCount: 0 });
    expect(room.owner.username).toBe('host');
    expect(room.speakers.map((s) => s.username)).toEqual(['host']);
  });

  it('validates the topic and type', async () => {
    const short = await t.http
      .post('/api/rooms')
      .set('Cookie', host.cookie)
      .send({ topic: 'hi', type: 'open' })
      .expect(400);
    expect(short.body.error.fields.topic).toBeTruthy();
    const badType = await t.http
      .post('/api/rooms')
      .set('Cookie', host.cookie)
      .send({ topic: 'A fine topic', type: 'secret' })
      .expect(400);
    expect(badType.body.error.fields.type).toBeTruthy();
  });

  it('lists open rooms to everyone, social rooms to followers, private rooms to the owner', async () => {
    await create('Open hallway', 'open');
    await create('Social circle', 'social');
    await create('Private huddle', 'private');

    expect(await list(stranger.cookie)).toEqual(expect.arrayContaining(['Open hallway']));
    expect(await list(stranger.cookie)).not.toContain('Social circle');
    expect(await list(stranger.cookie)).not.toContain('Private huddle');

    expect(await list(follower.cookie)).toEqual(expect.arrayContaining(['Open hallway', 'Social circle']));
    expect(await list(follower.cookie)).not.toContain('Private huddle');

    expect(await list(host.cookie)).toEqual(
      expect.arrayContaining(['Open hallway', 'Social circle', 'Private huddle']),
    );
  });

  it('searches topics case-insensitively and treats the query literally', async () => {
    await create('TypeScript 7 and the Go compiler', 'open');
    expect(await list(stranger.cookie, 'typescript')).toEqual(['TypeScript 7 and the Go compiler']);
    expect(await list(stranger.cookie, '.*')).toEqual([]);
  });

  it('lets anyone with the link open a private room but keeps social rooms for followers', async () => {
    const hidden = await create('Link only', 'private');
    await t.http.get(`/api/rooms/${hidden.id}`).set('Cookie', stranger.cookie).expect(200);

    const social = await create('Followers only', 'social');
    await t.http.get(`/api/rooms/${social.id}`).set('Cookie', follower.cookie).expect(200);
    const denied = await t.http.get(`/api/rooms/${social.id}`).set('Cookie', stranger.cookie).expect(403);
    expect(denied.body.error.message).toMatch(/Follow the host/);
  });

  it('only lets the owner end a room, after which it is gone', async () => {
    const room = await create('Short lived', 'open');
    await t.http.delete(`/api/rooms/${room.id}`).set('Cookie', stranger.cookie).expect(403);
    await t.http.delete(`/api/rooms/${room.id}`).set('Cookie', host.cookie).expect(204);
    await t.http.get(`/api/rooms/${room.id}`).set('Cookie', host.cookie).expect(404);
    expect(await list(host.cookie)).not.toContain('Short lived');
  });

  it('returns 404 for unknown rooms', async () => {
    await t.http.get('/api/rooms/doesnotexist').set('Cookie', host.cookie).expect(404);
  });
});
