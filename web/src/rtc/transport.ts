import type { SignalPayload } from '@devsbooth/shared';

export interface MediaEvents {
  /** Audio from a peer, ready to play. */
  track(peerId: string, stream: MediaStream): void;
  /** Whether audio can flow with a peer. */
  state(peerId: string, state: RTCPeerConnectionState): void;
}

/**
 * How audio moves between people in a room: a browser mesh (mesh.ts) or an SFU (sfu.ts).
 * The room session talks to this interface and does not care which one it has.
 */
export interface MediaTransport {
  /** Someone who was in the room before us. The mesh calls them; the SFU needs nothing. */
  peerPresent(peerId: string): void;
  /** An offer, answer or ICE candidate relayed by the server. Mesh only. */
  handleSignal(from: string, payload: SignalPayload): void;
  /** Sends this microphone track to the room, or stops sending with null. */
  setLocalTrack(track: MediaStreamTrack | null): Promise<void>;
  /** The current audio level (0..1) of every peer we receive. */
  levels(): Map<string, number>;
  /** A fresh SFU token after a role change. Mesh ignores it. */
  updateToken(token: string): void;
  hangUp(peerId: string): void;
  close(): void;
}

/** A source that has not delivered audio for this long is silent (Opus stops sending when muted). */
const STALE_SOURCE_MS = 400;

/** Loudest recent level among a receiver's sources. */
export function receiverLevel(receiver: RTCRtpReceiver): number {
  // The spec puts source timestamps on the performance.timeOrigin clock; accept either base.
  const absolute = performance.timeOrigin + performance.now();
  const relative = performance.now();
  let level = 0;
  for (const source of receiver.getSynchronizationSources()) {
    const age = Math.min(Math.abs(absolute - source.timestamp), Math.abs(relative - source.timestamp));
    if (age <= STALE_SOURCE_MS) level = Math.max(level, source.audioLevel ?? 0);
  }
  return level;
}
