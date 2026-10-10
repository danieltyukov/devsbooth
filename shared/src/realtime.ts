import type { ApiErrorCode, RoomSummary, UserSummary } from './api';

export type Role = 'speaker' | 'listener';

/** One connected browser tab in a room. `peerId` is its socket id. */
export interface Participant {
  peerId: string;
  user: UserSummary;
  role: Role;
  muted: boolean;
  handRaised: boolean;
}

export interface SessionDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface IceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type SignalPayload = { description: SessionDescription } | { candidate: IceCandidate };

export type Ack<T extends object = object> =
  ({ ok: true } & T) | { ok: false; error: { code: ApiErrorCode; message: string } };

export interface JoinResult {
  room: RoomSummary;
  self: Participant;
  /** Everyone already in the room, excluding `self`. The joiner sends them offers. */
  participants: Participant[];
}

export type ParticipantPatch = { peerId: string } & Partial<
  Pick<Participant, 'role' | 'muted' | 'handRaised'>
>;

export interface ServerToClientEvents {
  'peer:joined': (participant: Participant) => void;
  'peer:left': (event: { peerId: string }) => void;
  'peer:updated': (patch: ParticipantPatch) => void;
  'rtc:signal': (event: { from: string } & SignalPayload) => void;
  'room:ended': () => void;
  /** The host changed the room's details. */
  'room:updated': (patch: { topic: string }) => void;
  'room:kicked': (event: { reason: 'joined-elsewhere' }) => void;
}

export interface ClientToServerEvents {
  'room:join': (event: { roomId: string }, ack: (result: Ack<JoinResult>) => void) => void;
  'room:leave': () => void;
  'rtc:signal': (event: { to: string } & SignalPayload) => void;
  'mic:set': (event: { muted: boolean }) => void;
  'hand:set': (event: { raised: boolean }) => void;
  'role:set': (event: { peerId: string; role: Role }, ack: (result: Ack) => void) => void;
}
