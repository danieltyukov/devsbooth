import { describe, expect, it } from 'vitest';
import type { Participant, RoomSummary } from '@devsbooth/shared';
import { initialRoomState, roomReducer, selectSelf, selectStage, type RoomState } from './room-state';

const owner = { id: 'u-owner', username: 'owner', name: 'Owner', avatarUrl: null };
const room: RoomSummary = {
  id: 'abcdefghij',
  topic: 'Testing reducers',
  type: 'open',
  owner,
  speakers: [owner],
  participantCount: 1,
  createdAt: '2026-10-10T00:00:00.000Z',
};

function person(peerId: string, role: Participant['role'], userId = `u-${peerId}`): Participant {
  return {
    peerId,
    user: { id: userId, username: peerId, name: peerId, avatarUrl: null },
    role,
    muted: true,
    handRaised: false,
  };
}

function joined(): RoomState {
  return roomReducer(initialRoomState, {
    type: 'joined',
    room,
    self: person('me', 'listener'),
    participants: [person('host', 'speaker', owner.id)],
  });
}

describe('roomReducer', () => {
  it('starts with the people already there, then you', () => {
    const state = joined();
    expect(state.status).toBe('joined');
    expect(state.participants.map((p) => p.peerId)).toEqual(['host', 'me']);
    expect(selectSelf(state)?.peerId).toBe('me');
  });

  it('adds, updates and removes peers', () => {
    let state = joined();
    state = roomReducer(state, { type: 'peer-joined', participant: person('late', 'listener') });
    state = roomReducer(state, { type: 'peer-joined', participant: person('late', 'listener') });
    expect(state.participants).toHaveLength(3);

    state = roomReducer(state, { type: 'connection', peerId: 'late', state: 'connected' });
    state = roomReducer(state, { type: 'peer-updated', patch: { peerId: 'late', handRaised: true } });
    expect(state.participants.find((p) => p.peerId === 'late')?.handRaised).toBe(true);
    expect(state.connections.late).toBe('connected');

    state = roomReducer(state, { type: 'peer-left', peerId: 'late' });
    expect(state.participants).toHaveLength(2);
    expect(state.connections).not.toHaveProperty('late');
  });

  it('applies room changes from the host', () => {
    const state = roomReducer(joined(), { type: 'room-updated', patch: { topic: 'Renamed' } });
    expect(state.room?.topic).toBe('Renamed');
    expect(roomReducer(initialRoomState, { type: 'room-updated', patch: { topic: 'x' } }).room).toBeNull();
  });

  it('ignores connection updates for peers who already left', () => {
    const state = roomReducer(joined(), { type: 'connection', peerId: 'ghost', state: 'failed' });
    expect(state.connections).toEqual({});
  });

  it('clears the room on end, kick and failure', () => {
    for (const action of [{ type: 'ended' }, { type: 'kicked' }] as const) {
      const state = roomReducer(joined(), action);
      expect(state.participants).toEqual([]);
      expect(state.status).toBe(action.type);
    }
    const failed = roomReducer(joined(), { type: 'failed', error: { code: 'room_full', message: 'Full.' } });
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'room_full' } });
  });
});

describe('selectStage', () => {
  it('puts the host first among speakers and raised hands first in the audience', () => {
    let state = joined();
    state = roomReducer(state, { type: 'peer-joined', participant: person('guest', 'speaker') });
    state = roomReducer(state, { type: 'peer-joined', participant: person('quiet', 'listener') });
    state = roomReducer(state, { type: 'peer-joined', participant: person('eager', 'listener') });
    state = roomReducer(state, { type: 'peer-updated', patch: { peerId: 'eager', handRaised: true } });
    // Move the host to the back of the join order; they should still lead the stage.
    state = { ...state, participants: [...state.participants.slice(1), state.participants[0]!] };

    const { speakers, audience } = selectStage(state);
    expect(speakers.map((p) => p.peerId)).toEqual(['host', 'guest']);
    expect(audience.map((p) => p.peerId)).toEqual(['eager', 'me', 'quiet']);
  });
});
