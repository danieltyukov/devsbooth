import type { LocalTrackPublication, Room as LivekitRoom } from 'livekit-client';
import { receiverLevel, type MediaEvents, type MediaTransport } from './transport';

/**
 * Audio through a LiveKit SFU: every speaker publishes once and the SFU forwards it. The SFU also
 * enforces roles, since only a speaker's token (or permission) allows publishing.
 *
 * Participants are identified on the SFU by their peer id, so tracks map onto the same tiles as
 * in the mesh. livekit-client is loaded only when a room uses the SFU.
 */
export async function connectSfu(url: string, token: string, events: MediaEvents): Promise<MediaTransport> {
  const { Room, RoomEvent, Track } = await import('livekit-client');

  let latestToken = token;
  let localTrack: MediaStreamTrack | null = null;
  let published: LocalTrackPublication | null = null;
  let closed = false;
  /** Serializes connecting and publishing so a role change and a microphone switch cannot interleave. */
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch((err: unknown) => console.warn('DevsBooth: SFU step failed', err));
    return queue;
  };

  const open = async (): Promise<LivekitRoom> => {
    const next = new Room({ adaptiveStream: false, dynacast: false });
    next.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind !== Track.Kind.Audio) return;
      events.track(participant.identity, new MediaStream([track.mediaStreamTrack]));
      events.state(participant.identity, 'connected');
    });
    next.on(RoomEvent.ParticipantConnected, (participant) => events.state(participant.identity, 'connected'));
    next.on(RoomEvent.ParticipantDisconnected, (participant) => events.state(participant.identity, 'closed'));
    next.on(RoomEvent.Disconnected, () => {
      if (closed || room !== next) return;
      for (const participant of next.remoteParticipants.values())
        events.state(participant.identity, 'failed');
    });
    await next.connect(url, latestToken, { autoSubscribe: true });
    for (const participant of next.remoteParticipants.values())
      events.state(participant.identity, 'connected');
    return next;
  };

  let room = await open();

  // The SFU does not forward the RTP audio-level extension that getSynchronizationSources reads,
  // so levels come from the receiver's own measurement of the decoded audio, polled into a cache.
  const measured = new Map<string, number>();
  const measure = async () => {
    for (const participant of room.remoteParticipants.values()) {
      let level = 0;
      for (const publication of participant.audioTrackPublications.values()) {
        const stats = await publication.track?.receiver?.getStats();
        stats?.forEach((report: { type: string; audioLevel?: number }) => {
          if (report.type === 'inbound-rtp' && typeof report.audioLevel === 'number') {
            level = Math.max(level, report.audioLevel);
          }
        });
      }
      measured.set(participant.identity, level);
    }
  };
  const poll = window.setInterval(() => void measure().catch(() => {}), 100);

  const publish = async () => {
    if (published?.track) await room.localParticipant.unpublishTrack(published.track, false);
    published = null;
    if (!localTrack || closed) return;
    const options = { source: Track.Source.Microphone, name: 'microphone', dtx: true, red: true };
    try {
      published = await room.localParticipant.publishTrack(localTrack, options);
    } catch {
      // Promoted before the SFU knew this participant: reconnect with the token for the new role.
      room.removeAllListeners();
      await room.disconnect();
      room = await open();
      published = await room.localParticipant.publishTrack(localTrack, options);
    }
  };

  return {
    peerPresent() {},
    handleSignal() {},
    async setLocalTrack(track) {
      localTrack = track;
      await enqueue(publish);
    },
    levels() {
      const result = new Map<string, number>();
      for (const participant of room.remoteParticipants.values()) {
        let level = Math.max(participant.audioLevel, measured.get(participant.identity) ?? 0);
        for (const publication of participant.audioTrackPublications.values()) {
          const receiver = publication.track?.receiver;
          if (receiver) level = Math.max(level, receiverLevel(receiver));
        }
        result.set(participant.identity, level);
      }
      return result;
    },
    updateToken(next) {
      latestToken = next;
    },
    hangUp() {},
    close() {
      closed = true;
      window.clearInterval(poll);
      void room.disconnect();
    },
  };
}
