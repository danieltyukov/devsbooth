import type { Participant, ParticipantPatch } from '@devsbooth/shared';

export interface Removal {
  roomId: string;
  participant: Participant;
  /** Whether the room has nobody left in it. */
  empty: boolean;
}

/**
 * Who is in which room right now. One process keeps it in memory; several processes share it
 * through Redis (see redis-presence.ts). Every method is async so the two are interchangeable.
 */
export interface PresenceStore {
  /** True when other processes see the same state. */
  readonly shared: boolean;
  add(roomId: string, participant: Participant): Promise<void>;
  /** Removes a peer and reports which room it left. Null if it was not in one. */
  remove(peerId: string): Promise<Removal | null>;
  /** Removes everyone from a room and returns who was there. */
  clear(roomId: string): Promise<Participant[]>;
  roomOf(peerId: string): Promise<string | undefined>;
  get(peerId: string): Promise<Participant | undefined>;
  list(roomId: string): Promise<Participant[]>;
  count(roomId: string): Promise<number>;
  counts(roomIds: string[]): Promise<Record<string, number>>;
  peersOfUser(roomId: string, userId: string): Promise<Participant[]>;
  update(patch: ParticipantPatch): Promise<Participant | undefined>;
  /** Remembers that a room is being ended, so late joins can be refused. */
  markEnding(roomId: string, ttlMs: number): Promise<void>;
  isEnding(roomId: string): Promise<boolean>;
  unmarkEnding(roomId: string): Promise<void>;
  /** Removes participants whose process stopped. Only meaningful for shared stores. */
  sweep(): Promise<Removal[]>;
  close(): Promise<void>;
}

/** The single-process store: plain maps. */
export class MemoryPresence implements PresenceStore {
  readonly shared = false;
  private readonly rooms = new Map<string, Map<string, Participant>>();
  private readonly roomByPeer = new Map<string, string>();
  private readonly ending = new Map<string, NodeJS.Timeout>();

  async add(roomId: string, participant: Participant): Promise<void> {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Map();
      this.rooms.set(roomId, room);
    }
    room.set(participant.peerId, { ...participant });
    this.roomByPeer.set(participant.peerId, roomId);
  }

  async remove(peerId: string): Promise<Removal | null> {
    const roomId = this.roomByPeer.get(peerId);
    if (roomId === undefined) return null;
    this.roomByPeer.delete(peerId);
    const room = this.rooms.get(roomId);
    const participant = room?.get(peerId);
    if (!room || !participant) return null;
    room.delete(peerId);
    if (room.size === 0) this.rooms.delete(roomId);
    return { roomId, participant, empty: room.size === 0 };
  }

  async clear(roomId: string): Promise<Participant[]> {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    this.rooms.delete(roomId);
    for (const peerId of room.keys()) this.roomByPeer.delete(peerId);
    return [...room.values()];
  }

  async roomOf(peerId: string): Promise<string | undefined> {
    return this.roomByPeer.get(peerId);
  }

  async get(peerId: string): Promise<Participant | undefined> {
    const roomId = this.roomByPeer.get(peerId);
    const participant = roomId === undefined ? undefined : this.rooms.get(roomId)?.get(peerId);
    return participant ? { ...participant } : undefined;
  }

  async list(roomId: string): Promise<Participant[]> {
    return [...(this.rooms.get(roomId)?.values() ?? [])].map((participant) => ({ ...participant }));
  }

  async count(roomId: string): Promise<number> {
    return this.rooms.get(roomId)?.size ?? 0;
  }

  async counts(roomIds: string[]): Promise<Record<string, number>> {
    return Object.fromEntries(roomIds.map((id) => [id, this.rooms.get(id)?.size ?? 0]));
  }

  async peersOfUser(roomId: string, userId: string): Promise<Participant[]> {
    return (await this.list(roomId)).filter((participant) => participant.user.id === userId);
  }

  async update(patch: ParticipantPatch): Promise<Participant | undefined> {
    const roomId = this.roomByPeer.get(patch.peerId);
    const current = roomId === undefined ? undefined : this.rooms.get(roomId)?.get(patch.peerId);
    if (!current) return undefined;
    Object.assign(current, patch);
    return { ...current };
  }

  async markEnding(roomId: string, ttlMs: number): Promise<void> {
    clearTimeout(this.ending.get(roomId));
    const timer = setTimeout(() => this.ending.delete(roomId), ttlMs);
    timer.unref();
    this.ending.set(roomId, timer);
  }

  async isEnding(roomId: string): Promise<boolean> {
    return this.ending.has(roomId);
  }

  async unmarkEnding(roomId: string): Promise<void> {
    clearTimeout(this.ending.get(roomId));
    this.ending.delete(roomId);
  }

  async sweep(): Promise<Removal[]> {
    return [];
  }

  async close(): Promise<void> {
    for (const timer of this.ending.values()) clearTimeout(timer);
    this.ending.clear();
  }
}
