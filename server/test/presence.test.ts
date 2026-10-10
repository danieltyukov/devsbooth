import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import type { Participant } from '@devsbooth/shared';
import { MemoryPresence, type PresenceStore } from '../src/realtime/presence';
import { RedisPresence } from '../src/realtime/redis-presence';
import { sleep } from './helpers';

/** Set to run the shared-presence tests, e.g. TEST_REDIS_URL=redis://localhost:6379 */
const redisUrl = process.env.TEST_REDIS_URL;
const clients: Redis[] = [];
afterAll(async () => {
  await Promise.all(clients.map((client) => client.quit()));
});

function participant(peerId: string, userId = peerId): Participant {
  return {
    peerId,
    user: { id: userId, username: userId, name: userId, avatarUrl: null },
    role: 'listener',
    muted: true,
    handRaised: false,
  };
}

async function redisStore(prefix: string, heartbeatTtlMs = 15_000): Promise<RedisPresence> {
  const client = new Redis(redisUrl!);
  clients.push(client);
  return RedisPresence.create(client, {
    prefix,
    heartbeatMs: Math.min(5_000, heartbeatTtlMs / 3),
    heartbeatTtlMs,
  });
}

const stores: [string, () => Promise<PresenceStore>][] = [['memory', async () => new MemoryPresence()]];
if (redisUrl) {
  stores.push(['redis', () => redisStore(`test:${randomBytes(4).toString('hex')}:`)]);
}

describe.each(stores)('%s presence', (_name, make) => {
  it('tracks peers per room and reports when a room empties', async () => {
    const presence = await make();
    await presence.add('r1', participant('a'));
    await presence.add('r1', participant('b'));
    await presence.add('r2', participant('c'));
    expect(await presence.count('r1')).toBe(2);
    expect(await presence.counts(['r1', 'r2', 'r3'])).toEqual({ r1: 2, r2: 1, r3: 0 });
    expect(await presence.roomOf('c')).toBe('r2');
    expect((await presence.get('a'))?.user.id).toBe('a');

    expect(await presence.remove('a')).toMatchObject({
      roomId: 'r1',
      empty: false,
      participant: { peerId: 'a' },
    });
    expect(await presence.remove('b')).toMatchObject({ roomId: 'r1', empty: true });
    expect(await presence.count('r1')).toBe(0);
    expect(await presence.remove('b')).toBeNull();
    await presence.close();
  });

  it('updates and clears participants', async () => {
    const presence = await make();
    await presence.add('r', participant('a', 'u1'));
    await presence.add('r', participant('b', 'u1'));
    await presence.add('r', participant('c', 'u2'));
    expect((await presence.peersOfUser('r', 'u1')).map((p) => p.peerId).sort()).toEqual(['a', 'b']);
    expect(await presence.update({ peerId: 'a', muted: false, role: 'speaker' })).toMatchObject({
      peerId: 'a',
      muted: false,
      role: 'speaker',
      user: { id: 'u1', avatarUrl: null },
    });
    expect(await presence.update({ peerId: 'nobody', muted: false })).toBeUndefined();
    expect((await presence.clear('r')).map((p) => p.peerId).sort()).toEqual(['a', 'b', 'c']);
    expect(await presence.roomOf('a')).toBeUndefined();
    expect(await presence.count('r')).toBe(0);
    await presence.close();
  });

  it('remembers rooms being ended for a while', async () => {
    const presence = await make();
    await presence.markEnding('r', 200);
    expect(await presence.isEnding('r')).toBe(true);
    await sleep(300);
    expect(await presence.isEnding('r')).toBe(false);
    await presence.markEnding('r', 10_000);
    await presence.unmarkEnding('r');
    expect(await presence.isEnding('r')).toBe(false);
    await presence.close();
  });
});

describe.skipIf(!redisUrl)('redis presence across processes', () => {
  it('shares state between processes', async () => {
    const prefix = `test:${randomBytes(4).toString('hex')}:`;
    const a = await redisStore(prefix);
    const b = await redisStore(prefix);
    await a.add('room', participant('on-a'));
    await b.add('room', participant('on-b'));
    expect(await b.count('room')).toBe(2);
    expect(await a.roomOf('on-b')).toBe('room');
    expect(await b.update({ peerId: 'on-a', handRaised: true })).toMatchObject({ handRaised: true });
    expect((await a.get('on-a'))?.handRaised).toBe(true);
    await Promise.all([a.close(), b.close()]);
  });

  it('sweeps the peers of a process that shut down', async () => {
    const prefix = `test:${randomBytes(4).toString('hex')}:`;
    const a = await redisStore(prefix);
    const b = await redisStore(prefix);
    await a.add('room', participant('on-a'));
    await b.add('room', participant('on-b'));
    expect(await b.sweep()).toEqual([]);

    await a.close();
    expect(await b.sweep()).toEqual([{ roomId: 'room', participant: participant('on-a'), empty: false }]);
    expect(await b.count('room')).toBe(1);
    expect(await b.sweep()).toEqual([]);
    await b.close();
  });

  it('sweeps the peers of a process that crashed once its heartbeat runs out', async () => {
    const prefix = `test:${randomBytes(4).toString('hex')}:`;
    const crashing = new Redis(redisUrl!);
    const a = await RedisPresence.create(crashing, { prefix, heartbeatMs: 100, heartbeatTtlMs: 400 });
    const b = await redisStore(prefix);
    await a.add('room', participant('on-a'));

    // The process dies without a word: its connection drops and the heartbeat stops.
    crashing.disconnect();
    expect(await b.sweep()).toEqual([]);
    await sleep(600);
    expect(await b.sweep()).toEqual([{ roomId: 'room', participant: participant('on-a'), empty: true }]);
    await b.close();
  });
});
