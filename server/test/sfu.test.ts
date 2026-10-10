import { TokenVerifier } from 'livekit-server-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomSummary } from '@devsbooth/shared';
import { ConfigError, loadConfig } from '../src/config';
import { livekitGateway, type SfuGateway, type SfuParticipant } from '../src/media/sfu';
import { emitWithAck, next, sleep, startTestApp, type TestApp } from './helpers';

const KEY = 'devkey';
const SECRET = 'a-secret-that-is-long-enough-for-hmac-signing';
const verifier = new TokenVerifier(KEY, SECRET);

/** Real tokens, recorded API calls: no LiveKit server needed. */
function recordingSfu() {
  const real = livekitGateway({
    url: 'ws://sfu.test',
    apiUrl: 'http://sfu.test',
    apiKey: KEY,
    apiSecret: SECRET,
  });
  const calls: string[] = [];
  /** Who the fake SFU reports as connected. */
  const connected: SfuParticipant[] = [];
  const gateway: SfuGateway = {
    url: real.url,
    token: (input) => real.token(input),
    async setCanPublish(roomId, peerId, canPublish) {
      calls.push(`publish ${peerId} ${canPublish}`);
    },
    async removePeer(roomId, peerId) {
      calls.push(`remove ${peerId}`);
    },
    async closeRoom(roomId) {
      calls.push(`close ${roomId}`);
    },
    async participants() {
      return [...connected];
    },
  };
  return { gateway, calls, connected };
}

async function grants(token: string) {
  const claims = await verifier.verify(token);
  return { identity: claims.sub, video: claims.video, lifetime: (claims.exp ?? 0) - (claims.nbf ?? 0) };
}

describe('SFU configuration', () => {
  it('needs the URL, key and secret together, with a WebSocket URL', () => {
    expect(() => loadConfig({ LIVEKIT_URL: 'wss://sfu.example.org' })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ LIVEKIT_URL: 'https://sfu.example.org', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' }),
    ).toThrow(/wss:/);
    const config = loadConfig({
      LIVEKIT_URL: 'wss://sfu.example.org/',
      LIVEKIT_API_KEY: 'k',
      LIVEKIT_API_SECRET: 's',
    });
    expect(config.sfu).toEqual({
      url: 'wss://sfu.example.org',
      apiUrl: 'https://sfu.example.org/',
      apiKey: 'k',
      apiSecret: 's',
    });
    // An SFU carries far more people than a mesh, unless told otherwise.
    expect(config.room.maxParticipants).toBe(200);
    expect(loadConfig({}).room.maxParticipants).toBe(25);
  });
});

describe('with an SFU', () => {
  let t: TestApp;
  let sfu: ReturnType<typeof recordingSfu>;
  let host: { cookie: string };
  let guest: { cookie: string };

  beforeAll(async () => {
    sfu = recordingSfu();
    t = await startTestApp({}, { sfu: sfu.gateway, hub: { sfuCheckMs: 100 } });
    host = await t.createUser('sfu_host');
    guest = await t.createUser('sfu_guest');
  });
  afterAll(async () => {
    await t.close();
  });

  async function createRoom(): Promise<RoomSummary> {
    const res = await t.http
      .post('/api/rooms')
      .set('Cookie', host.cookie)
      .send({ topic: 'Through the SFU', type: 'open' });
    return res.body.room as RoomSummary;
  }

  it('tells clients to use the SFU, and allows its origin in the CSP', async () => {
    const res = await t.http.get('/api/config').set('Cookie', guest.cookie).expect(200);
    expect(res.body).toMatchObject({ media: 'sfu', sfuUrl: 'ws://sfu.test' });
    const page = await t.http.get('/api/health');
    expect(page.headers['content-security-policy']).toMatch(
      /connect-src[^;]*ws:\/\/sfu\.test[^;]*http:\/\/sfu\.test/,
    );
  });

  it('hands out tokens whose publish permission matches the role', async () => {
    const room = await createRoom();
    const a = await t.socket(host.cookie);
    const b = await t.socket(guest.cookie);
    const ja = await emitWithAck(a, 'room:join', { roomId: room.id });
    const jb = await emitWithAck(b, 'room:join', { roomId: room.id });
    if (!ja.ok || !jb.ok) throw new Error('join failed');

    const hostGrants = await grants(ja.sfuToken!);
    expect(hostGrants).toMatchObject({
      identity: ja.self.peerId,
      video: {
        room: `devsbooth_${room.id}`,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
      },
    });
    // Only long enough to connect; LiveKit refreshes tokens for connected clients.
    expect(hostGrants.lifetime).toBeLessThanOrEqual(60);
    expect(await grants(jb.sfuToken!)).toMatchObject({
      identity: jb.self.peerId,
      video: { room: `devsbooth_${room.id}`, canPublish: false, canSubscribe: true },
    });
  });

  it('changes the SFU permission and sends a fresh token when the host changes a role', async () => {
    const room = await createRoom();
    const a = await t.socket(host.cookie);
    const b = await t.socket(guest.cookie);
    await emitWithAck(a, 'room:join', { roomId: room.id });
    const jb = await emitWithAck(b, 'room:join', { roomId: room.id });
    if (!jb.ok) throw new Error('join failed');

    sfu.calls.length = 0;
    const token = next(b, 'media:token');
    expect(await emitWithAck(a, 'role:set', { peerId: jb.self.peerId, role: 'speaker' })).toEqual({
      ok: true,
    });
    expect(sfu.calls).toEqual([`publish ${jb.self.peerId} true`]);
    expect((await grants((await token).token)).video).toMatchObject({ canPublish: true });

    const revoked = next(b, 'media:token');
    await emitWithAck(a, 'role:set', { peerId: jb.self.peerId, role: 'listener' });
    expect(sfu.calls).toContain(`publish ${jb.self.peerId} false`);
    expect((await grants((await revoked).token)).video).toMatchObject({ canPublish: false });
  });

  it('drops a replaced tab from the SFU and closes the SFU room when the room ends', async () => {
    const room = await createRoom();
    const first = await t.socket(guest.cookie);
    const j1 = await emitWithAck(first, 'room:join', { roomId: room.id });
    if (!j1.ok) throw new Error('join failed');
    const second = await t.socket(guest.cookie);
    await emitWithAck(second, 'room:join', { roomId: room.id });
    expect(sfu.calls).toContain(`remove ${j1.self.peerId}`);

    await t.http.delete(`/api/rooms/${room.id}`).set('Cookie', host.cookie).expect(204);
    expect(sfu.calls).toContain(`close ${room.id}`);
  });

  it('removes people from the SFU when they leave the room', async () => {
    const room = await createRoom();
    const b = await t.socket(guest.cookie);
    const jb = await emitWithAck(b, 'room:join', { roomId: room.id });
    if (!jb.ok) throw new Error('join failed');
    sfu.calls.length = 0;
    b.emit('room:leave');
    await sleep(100);
    expect(sfu.calls).toContain(`remove ${jb.self.peerId}`);
  });

  it('removes SFU participants the room does not list, and revokes publishing from listeners', async () => {
    const room = await createRoom();
    const b = await t.socket(guest.cookie);
    const jb = await emitWithAck(b, 'room:join', { roomId: room.id });
    if (!jb.ok) throw new Error('join failed');

    sfu.calls.length = 0;
    sfu.connected.push(
      // Left the room but kept, or reused, its SFU connection.
      { roomId: room.id, peerId: 'invisible-listener', canPublish: false },
      // In the room as a listener, but somehow allowed to publish.
      { roomId: room.id, peerId: jb.self.peerId, canPublish: true },
    );
    await sleep(350);
    sfu.connected.length = 0;
    expect(sfu.calls).toContain('remove invisible-listener');
    expect(sfu.calls).toContain(`publish ${jb.self.peerId} false`);
    expect(sfu.calls).not.toContain(`remove ${jb.self.peerId}`);
  });
});
