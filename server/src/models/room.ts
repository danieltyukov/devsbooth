import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { ROOM_TYPES, type RoomType } from '@devsbooth/shared';

export interface RoomFields {
  /** Random id used in URLs, so private room links cannot be guessed. */
  publicId: string;
  topic: string;
  type: RoomType;
  owner: Types.ObjectId;
  /** Users allowed to speak. The owner is always one. */
  speakers: Types.ObjectId[];
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const roomSchema = new Schema<RoomFields>(
  {
    publicId: { type: String, required: true, unique: true },
    topic: { type: String, required: true, trim: true },
    type: { type: String, enum: ROOM_TYPES, required: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    speakers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

roomSchema.index({ endedAt: 1, createdAt: -1 });

export const Room = model<RoomFields>('Room', roomSchema, 'rooms');
export type RoomDoc = HydratedDocument<RoomFields>;
