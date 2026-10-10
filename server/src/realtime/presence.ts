import type { Participant, ParticipantPatch } from '@devsbooth/shared';

/** Who is in which room right now. In memory, so it is per server process. */
export class Presence {
  private readonly rooms = new Map<string, Map<string, Participant>>();
  private readonly roomByPeer = new Map<string, string>();

  add(roomId: string, participant: Participant): void {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Map();
      this.rooms.set(roomId, room);
    }
    room.set(participant.peerId, participant);
    this.roomByPeer.set(participant.peerId, roomId);
  }

  /** Removes a peer and reports which room it left, and whether that room is now empty. */
  remove(peerId: string): { roomId: string; participant: Participant; empty: boolean } | null {
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

  /** Removes everyone from a room and returns who was there. */
  clear(roomId: string): Participant[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    this.rooms.delete(roomId);
    for (const peerId of room.keys()) this.roomByPeer.delete(peerId);
    return [...room.values()];
  }

  roomOf(peerId: string): string | undefined {
    return this.roomByPeer.get(peerId);
  }

  get(peerId: string): Participant | undefined {
    const roomId = this.roomByPeer.get(peerId);
    return roomId === undefined ? undefined : this.rooms.get(roomId)?.get(peerId);
  }

  list(roomId: string): Participant[] {
    return [...(this.rooms.get(roomId)?.values() ?? [])];
  }

  count(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0;
  }

  peersOfUser(roomId: string, userId: string): Participant[] {
    return this.list(roomId).filter((participant) => participant.user.id === userId);
  }

  update(patch: ParticipantPatch): Participant | undefined {
    const current = this.get(patch.peerId);
    if (!current) return undefined;
    Object.assign(current, patch);
    return current;
  }
}
