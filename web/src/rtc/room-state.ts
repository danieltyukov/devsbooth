import type { ApiErrorCode, Participant, ParticipantPatch, RoomSummary } from '@devsbooth/shared';

export type RoomStatus = 'connecting' | 'joined' | 'ended' | 'kicked' | 'failed';

export interface RoomState {
  status: RoomStatus;
  error: { code: ApiErrorCode | 'connection'; message: string } | null;
  room: RoomSummary | null;
  selfId: string | null;
  /** Everyone in the room, including you, in the order they joined. */
  participants: Participant[];
  /** WebRTC connection state per remote peer. */
  connections: Record<string, RTCPeerConnectionState>;
}

export type RoomAction =
  | { type: 'connecting' }
  | { type: 'joined'; room: RoomSummary; self: Participant; participants: Participant[] }
  | { type: 'peer-joined'; participant: Participant }
  | { type: 'peer-left'; peerId: string }
  | { type: 'peer-updated'; patch: ParticipantPatch }
  | { type: 'connection'; peerId: string; state: RTCPeerConnectionState }
  | { type: 'room-updated'; patch: Partial<Pick<RoomSummary, 'topic'>> }
  | { type: 'ended' }
  | { type: 'kicked' }
  | { type: 'failed'; error: NonNullable<RoomState['error']> };

export const initialRoomState: RoomState = {
  status: 'connecting',
  error: null,
  room: null,
  selfId: null,
  participants: [],
  connections: {},
};

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case 'connecting':
      return { ...initialRoomState, room: state.room };
    case 'joined':
      return {
        status: 'joined',
        error: null,
        room: action.room,
        selfId: action.self.peerId,
        participants: [...action.participants, action.self],
        connections: {},
      };
    case 'peer-joined':
      if (state.participants.some((p) => p.peerId === action.participant.peerId)) return state;
      return { ...state, participants: [...state.participants, action.participant] };
    case 'peer-left':
      return {
        ...state,
        participants: state.participants.filter((p) => p.peerId !== action.peerId),
        connections: without(state.connections, action.peerId),
      };
    case 'peer-updated':
      return {
        ...state,
        participants: state.participants.map((p) =>
          p.peerId === action.patch.peerId ? { ...p, ...action.patch } : p,
        ),
      };
    case 'connection':
      if (!state.participants.some((p) => p.peerId === action.peerId)) return state;
      return { ...state, connections: { ...state.connections, [action.peerId]: action.state } };
    case 'room-updated':
      return state.room ? { ...state, room: { ...state.room, ...action.patch } } : state;
    case 'ended':
      return { ...state, status: 'ended', participants: [], connections: {} };
    case 'kicked':
      return { ...state, status: 'kicked', participants: [], connections: {} };
    case 'failed':
      return { ...state, status: 'failed', error: action.error, participants: [], connections: {} };
  }
}

export function selectSelf(state: RoomState): Participant | undefined {
  return state.participants.find((p) => p.peerId === state.selfId);
}

/** Speakers with the host first, then everyone else in join order. */
export function selectStage(state: RoomState): { speakers: Participant[]; audience: Participant[] } {
  const ownerId = state.room?.owner.id;
  const speakers = state.participants
    .filter((p) => p.role === 'speaker')
    .sort((a, b) => Number(b.user.id === ownerId) - Number(a.user.id === ownerId));
  // Raised hands float to the front of the audience so the host sees them.
  const audience = state.participants
    .filter((p) => p.role === 'listener')
    .sort((a, b) => Number(b.handRaised) - Number(a.handRaised));
  return { speakers, audience };
}
