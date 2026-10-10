import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Config } from '../config';
import { log } from '../log';
import type { IoServer } from './hub';
import { MemoryPresence, type PresenceStore } from './presence';
import { RedisPresence, type RedisPresenceOptions } from './redis-presence';

/**
 * Where realtime state lives. One process keeps it in memory; with REDIS_URL, several processes
 * share presence through Redis and reach each other's sockets through the Socket.IO Redis adapter.
 */
export interface RealtimeBackend {
  presence: PresenceStore;
  attach(io: IoServer): void;
  close(): Promise<void>;
}

export function memoryBackend(): RealtimeBackend {
  const presence = new MemoryPresence();
  return { presence, attach() {}, close: () => presence.close() };
}

export async function redisBackend(
  url: string,
  options: RedisPresenceOptions & { sweepMs?: number } = {},
): Promise<RealtimeBackend> {
  const prefix = options.prefix ?? 'devsbooth:';
  const data = new Redis(url, { lazyConnect: true });
  await data.connect();
  const pub = data.duplicate();
  const sub = data.duplicate();
  for (const client of [data, pub, sub]) {
    client.on('error', (err: unknown) => log.error('Redis connection error', { err }));
  }
  const presence = await RedisPresence.create(data, { ...options, prefix });
  log.info('Sharing realtime state through Redis', { server: presence.serverId });
  return {
    presence,
    attach(io) {
      io.adapter(createAdapter(pub, sub, { key: `${prefix}socket.io` }));
    },
    async close() {
      await presence.close();
      await Promise.all([data.quit(), pub.quit(), sub.quit()]);
    },
  };
}

export async function createRealtimeBackend(config: Config): Promise<RealtimeBackend> {
  return config.redis.url ? redisBackend(config.redis.url, { prefix: config.redis.prefix }) : memoryBackend();
}
