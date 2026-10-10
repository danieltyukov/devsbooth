import { randomBytes } from 'node:crypto';
import type { Types } from 'mongoose';
import type { RoomSummary, RoomType } from '@devsbooth/shared';
import { Follow } from '../models/follow';
import { Room, type RoomFields } from '../models/room';
import type { UserDoc, UserFields } from '../models/user';
import { toSummary } from '../users/dto';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ID_LENGTH = 10;

/** A 10 character base62 id: about 59 bits, enough that private links cannot be guessed. */
export function newRoomId(): string {
  let id = '';
  while (id.length < ID_LENGTH) {
    for (const byte of randomBytes(ID_LENGTH * 2)) {
      // 248 is the largest multiple of 62 below 256; rejecting the rest keeps the distribution even.
      if (byte >= 248) continue;
      id += ID_ALPHABET[byte % 62];
      if (id.length === ID_LENGTH) break;
    }
  }
  return id;
}

type PopulatedUser = Pick<UserFields, 'username' | 'name' | 'avatar'> & { _id: Types.ObjectId };

export type PopulatedRoom = Omit<RoomFields, 'owner' | 'speakers'> & {
  _id: Types.ObjectId;
  owner: PopulatedUser;
  speakers: PopulatedUser[];
};

const USER_FIELDS = 'username name avatar';

export async function createRoom(owner: UserDoc, input: { topic: string; type: RoomType }): Promise<string> {
  const room = await Room.create({
    publicId: newRoomId(),
    topic: input.topic,
    type: input.type,
    owner: owner._id,
    speakers: [owner._id],
  });
  return room.publicId;
}

/** A room that has not ended, with owner and speakers populated, or null. */
export async function findLiveRoom(publicId: string): Promise<PopulatedRoom | null> {
  return Room.findOne({ publicId, endedAt: null })
    .populate<{ owner: PopulatedUser }>('owner', USER_FIELDS)
    .populate<{ speakers: PopulatedUser[] }>('speakers', USER_FIELDS)
    .lean<PopulatedRoom>()
    .exec();
}

export async function follows(followerId: Types.ObjectId, followeeId: Types.ObjectId): Promise<boolean> {
  return (await Follow.exists({ follower: followerId, followee: followeeId })) !== null;
}

/**
 * Open and private rooms are reachable by anyone signed in who has the link.
 * Social rooms are for the owner and the owner's followers.
 */
export async function canEnter(room: PopulatedRoom, viewer: UserDoc): Promise<boolean> {
  if (room.type !== 'social') return true;
  if (room.owner._id.equals(viewer._id)) return true;
  return follows(viewer._id, room.owner._id);
}

export function isSpeaker(room: Pick<PopulatedRoom, 'owner' | 'speakers'>, userId: Types.ObjectId): boolean {
  return room.owner._id.equals(userId) || room.speakers.some((speaker) => speaker._id.equals(userId));
}

export function toRoomSummary(room: PopulatedRoom, participantCount: number): RoomSummary {
  return {
    id: room.publicId,
    topic: room.topic,
    type: room.type,
    owner: toSummary(room.owner),
    speakers: room.speakers.filter(Boolean).map(toSummary),
    participantCount,
    createdAt: room.createdAt.toISOString(),
  };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Live participant counts for a batch of rooms, keyed by room id. */
export type CountRooms = (roomIds: string[]) => Promise<Record<string, number>>;

async function summarize(rooms: PopulatedRoom[], countRooms: CountRooms): Promise<RoomSummary[]> {
  const counts = await countRooms(rooms.map((room) => room.publicId));
  return rooms
    .map((room) => toRoomSummary(room, counts[room.publicId] ?? 0))
    .sort((a, b) => b.participantCount - a.participantCount || b.createdAt.localeCompare(a.createdAt));
}

function findPopulated(filter: Record<string, unknown>) {
  return Room.find(filter)
    .sort({ createdAt: -1 })
    .limit(200)
    .populate<{ owner: PopulatedUser }>('owner', USER_FIELDS)
    .populate<{ speakers: PopulatedUser[] }>('speakers', USER_FIELDS)
    .lean<PopulatedRoom[]>()
    .exec();
}

/**
 * Rooms listed for `viewer`: every open room, social rooms of people they follow,
 * and all of their own rooms. Busiest first, then newest.
 */
export async function listRooms(
  viewer: UserDoc,
  query: string,
  countRooms: CountRooms,
): Promise<RoomSummary[]> {
  const following = await Follow.find({ follower: viewer._id }).distinct('followee');
  const filter: Record<string, unknown> = {
    endedAt: null,
    $or: [{ type: 'open' }, { type: 'social', owner: { $in: following } }, { owner: viewer._id }],
  };
  const q = query.trim();
  if (q) filter.topic = { $regex: escapeRegex(q), $options: 'i' };
  return summarize(await findPopulated(filter), countRooms);
}

/**
 * Live rooms hosted by `host` that `viewer` may see: open rooms, follower rooms when the viewer
 * follows the host, and private rooms only when the viewer is the host.
 */
export async function listHostedRooms(
  host: UserDoc,
  viewer: UserDoc,
  countRooms: CountRooms,
): Promise<RoomSummary[]> {
  const types: RoomType[] = ['open'];
  if (host._id.equals(viewer._id)) types.push('social', 'private');
  else if (await follows(viewer._id, host._id)) types.push('social');
  return summarize(await findPopulated({ endedAt: null, owner: host._id, type: { $in: types } }), countRooms);
}

/** Changes a live room's topic. Returns false if the room has ended or does not exist. */
export async function setTopic(publicId: string, topic: string): Promise<boolean> {
  const result = await Room.updateOne({ publicId, endedAt: null }, { topic });
  return result.matchedCount === 1;
}

/** Marks a room ended. Returns false if it was already ended or does not exist. */
export async function markEnded(publicId: string): Promise<boolean> {
  const result = await Room.updateOne({ publicId, endedAt: null }, { endedAt: new Date() });
  return result.modifiedCount === 1;
}

export async function setSpeaker(publicId: string, userId: Types.ObjectId, speaker: boolean): Promise<void> {
  await Room.updateOne(
    { publicId },
    speaker ? { $addToSet: { speakers: userId } } : { $pull: { speakers: userId } },
  );
}

export async function liveRoomIds(): Promise<string[]> {
  return Room.find({ endedAt: null }).distinct('publicId');
}
