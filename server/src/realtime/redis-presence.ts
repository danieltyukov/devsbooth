import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Participant, ParticipantPatch } from '@devsbooth/shared';
import { log } from '../log';
import type { AddResult, PresenceStore, Removal } from './presence';

/*
 * Keys, all under a prefix:
 *   room:<roomId>           hash   peerId -> participant JSON
 *   peer:<peerId>           hash   room, server
 *   server:<id>:alive       string heartbeat, expires unless refreshed
 *   server:<id>:peers       set    peers connected to that process
 *   servers                 set    every process that has registered
 *   ending:<roomId>         string a room being ended, expires
 *   sweep-lock              string one sweeper at a time
 *
 * Multi-key changes run as Lua scripts so they are atomic. The scripts build some key names
 * themselves, which works on a single Redis instance (not Redis Cluster).
 */

const ADD = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('HSET', KEYS[2], 'room', ARGV[3], 'server', ARGV[4])
redis.call('SADD', KEYS[3], ARGV[1])
return 1`;

const JOIN = `
if redis.call('EXISTS', KEYS[4]) == 1 then return 'ending' end
if redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[5]) then return 'full' end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('HSET', KEYS[2], 'room', ARGV[3], 'server', ARGV[4])
redis.call('SADD', KEYS[3], ARGV[1])
return 'added'`;

const REMOVE = `
local roomId = redis.call('HGET', KEYS[1], 'room')
if not roomId then return false end
local server = redis.call('HGET', KEYS[1], 'server')
local hash = ARGV[2] .. 'room:' .. roomId
local json = redis.call('HGET', hash, ARGV[1])
redis.call('HDEL', hash, ARGV[1])
redis.call('DEL', KEYS[1])
if server then redis.call('SREM', ARGV[2] .. 'server:' .. server .. ':peers', ARGV[1]) end
return {roomId, json or '', redis.call('HLEN', hash)}`;

const CLEAR = `
local all = redis.call('HGETALL', KEYS[1])
for i = 1, #all, 2 do
  local peerKey = ARGV[1] .. 'peer:' .. all[i]
  local server = redis.call('HGET', peerKey, 'server')
  if server then redis.call('SREM', ARGV[1] .. 'server:' .. server .. ':peers', all[i]) end
  redis.call('DEL', peerKey)
end
redis.call('DEL', KEYS[1])
return all`;

const UPDATE = `
local roomId = redis.call('HGET', KEYS[1], 'room')
if not roomId then return false end
local hash = ARGV[3] .. 'room:' .. roomId
local json = redis.call('HGET', hash, ARGV[1])
if not json then return false end
local participant = cjson.decode(json)
for key, value in pairs(cjson.decode(ARGV[2])) do participant[key] = value end
local out = cjson.encode(participant)
redis.call('HSET', hash, ARGV[1], out)
return out`;

interface Scripts {
  presenceAdd(room: string, peer: string, serverPeers: string, ...args: string[]): Promise<number>;
  presenceJoin(
    room: string,
    peer: string,
    serverPeers: string,
    ending: string,
    ...args: string[]
  ): Promise<AddResult>;
  presenceRemove(peer: string, peerId: string, prefix: string): Promise<[string, string, number] | null>;
  presenceClear(room: string, prefix: string): Promise<string[]>;
  presenceUpdate(peer: string, peerId: string, patch: string, prefix: string): Promise<string | null>;
}

export interface RedisPresenceOptions {
  prefix?: string;
  /** How often this process refreshes its heartbeat. */
  heartbeatMs?: number;
  /** How long a heartbeat lasts; a process silent for longer counts as gone. */
  heartbeatTtlMs?: number;
}

/** Presence shared by every process through one Redis instance. */
export class RedisPresence implements PresenceStore {
  readonly shared = true;
  readonly serverId = randomBytes(8).toString('hex');
  private readonly prefix: string;
  private readonly heartbeatTtlMs: number;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly redis: Redis & Scripts;

  private constructor(redis: Redis, options: Required<RedisPresenceOptions>) {
    redis.defineCommand('presenceAdd', { numberOfKeys: 3, lua: ADD });
    redis.defineCommand('presenceJoin', { numberOfKeys: 4, lua: JOIN });
    redis.defineCommand('presenceRemove', { numberOfKeys: 1, lua: REMOVE });
    redis.defineCommand('presenceClear', { numberOfKeys: 1, lua: CLEAR });
    redis.defineCommand('presenceUpdate', { numberOfKeys: 1, lua: UPDATE });
    this.redis = redis as Redis & Scripts;
    this.prefix = options.prefix;
    this.heartbeatTtlMs = options.heartbeatTtlMs;
    this.heartbeat = setInterval(() => {
      this.beat().catch((err: unknown) => log.warn('Presence heartbeat failed', { err }));
    }, options.heartbeatMs);
    this.heartbeat.unref();
  }

  /** Registers this process and starts its heartbeat. */
  static async create(redis: Redis, options: RedisPresenceOptions = {}): Promise<RedisPresence> {
    const presence = new RedisPresence(redis, {
      prefix: options.prefix ?? 'devsbooth:',
      heartbeatMs: options.heartbeatMs ?? 5_000,
      heartbeatTtlMs: options.heartbeatTtlMs ?? 15_000,
    });
    await presence.beat();
    return presence;
  }

  private key(...parts: string[]): string {
    return this.prefix + parts.join(':');
  }

  private async beat(): Promise<void> {
    await this.redis
      .multi()
      .set(this.key('server', this.serverId, 'alive'), '1', 'PX', this.heartbeatTtlMs)
      .sadd(this.key('servers'), this.serverId)
      .exec();
  }

  async add(roomId: string, participant: Participant): Promise<void> {
    await this.redis.presenceAdd(
      this.key('room', roomId),
      this.key('peer', participant.peerId),
      this.key('server', this.serverId, 'peers'),
      participant.peerId,
      JSON.stringify(participant),
      roomId,
      this.serverId,
    );
  }

  async join(roomId: string, participant: Participant, max: number): Promise<AddResult> {
    return this.redis.presenceJoin(
      this.key('room', roomId),
      this.key('peer', participant.peerId),
      this.key('server', this.serverId, 'peers'),
      this.key('ending', roomId),
      participant.peerId,
      JSON.stringify(participant),
      roomId,
      this.serverId,
      String(max),
    );
  }

  async remove(peerId: string): Promise<Removal | null> {
    const result = await this.redis.presenceRemove(this.key('peer', peerId), peerId, this.prefix);
    if (!result || !result[1]) return null;
    const [roomId, json, left] = result;
    return { roomId, participant: JSON.parse(json) as Participant, empty: Number(left) === 0 };
  }

  async clear(roomId: string): Promise<Participant[]> {
    const flat = await this.redis.presenceClear(this.key('room', roomId), this.prefix);
    const participants: Participant[] = [];
    for (let i = 1; i < flat.length; i += 2) participants.push(JSON.parse(flat[i]!) as Participant);
    return participants;
  }

  async roomOf(peerId: string): Promise<string | undefined> {
    return (await this.redis.hget(this.key('peer', peerId), 'room')) ?? undefined;
  }

  async get(peerId: string): Promise<Participant | undefined> {
    const roomId = await this.roomOf(peerId);
    if (roomId === undefined) return undefined;
    const json = await this.redis.hget(this.key('room', roomId), peerId);
    return json ? (JSON.parse(json) as Participant) : undefined;
  }

  async list(roomId: string): Promise<Participant[]> {
    const values = await this.redis.hvals(this.key('room', roomId));
    return values.map((json) => JSON.parse(json) as Participant);
  }

  async count(roomId: string): Promise<number> {
    return this.redis.hlen(this.key('room', roomId));
  }

  async counts(roomIds: string[]): Promise<Record<string, number>> {
    if (roomIds.length === 0) return {};
    const pipeline = this.redis.pipeline();
    for (const roomId of roomIds) pipeline.hlen(this.key('room', roomId));
    const results = (await pipeline.exec()) ?? [];
    return Object.fromEntries(roomIds.map((roomId, i) => [roomId, Number(results[i]?.[1] ?? 0)]));
  }

  async peersOfUser(roomId: string, userId: string): Promise<Participant[]> {
    return (await this.list(roomId)).filter((participant) => participant.user.id === userId);
  }

  async update(patch: ParticipantPatch): Promise<Participant | undefined> {
    const { peerId, ...fields } = patch;
    const json = await this.redis.presenceUpdate(
      this.key('peer', peerId),
      peerId,
      JSON.stringify(fields),
      this.prefix,
    );
    return json ? (JSON.parse(json) as Participant) : undefined;
  }

  async markEnding(roomId: string, ttlMs: number): Promise<void> {
    await this.redis.set(this.key('ending', roomId), '1', 'PX', ttlMs);
  }

  async isEnding(roomId: string): Promise<boolean> {
    return (await this.redis.exists(this.key('ending', roomId))) === 1;
  }

  async unmarkEnding(roomId: string): Promise<void> {
    await this.redis.del(this.key('ending', roomId));
  }

  /** Removes the participants of processes whose heartbeat expired. One process sweeps at a time. */
  async sweep(): Promise<Removal[]> {
    const lock = await this.redis.set(this.key('sweep-lock'), this.serverId, 'PX', 5_000, 'NX');
    if (lock !== 'OK') return [];
    const removals: Removal[] = [];
    try {
      for (const serverId of await this.redis.smembers(this.key('servers'))) {
        if (serverId === this.serverId) continue;
        if ((await this.redis.exists(this.key('server', serverId, 'alive'))) === 1) continue;
        for (const peerId of await this.redis.smembers(this.key('server', serverId, 'peers'))) {
          const removal = await this.remove(peerId);
          if (removal) removals.push(removal);
        }
        await this.redis
          .multi()
          .del(this.key('server', serverId, 'peers'))
          .srem(this.key('servers'), serverId)
          .exec();
      }
    } finally {
      // Release the lock only if it is still ours (it may have expired during a slow sweep).
      await this.redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
        1,
        this.key('sweep-lock'),
        this.serverId,
      );
    }
    return removals;
  }

  /**
   * Stops the heartbeat and withdraws it at once, so the other processes sweep any peers still
   * listed for this one on their next pass and tell the rooms they left.
   */
  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    await this.redis.del(this.key('server', this.serverId, 'alive'));
  }
}
