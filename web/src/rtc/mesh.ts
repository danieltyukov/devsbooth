import type { IceServer, SignalPayload } from '@devsbooth/shared';

export interface MeshEvents {
  signal(to: string, payload: SignalPayload): void;
  track(peerId: string, stream: MediaStream): void;
  state(peerId: string, state: RTCPeerConnectionState): void;
}

interface Peer {
  pc: RTCPeerConnection;
  sender: RTCRtpSender | null;
  /** ICE candidates that arrived before the remote description. */
  pending: RTCIceCandidateInit[];
  /** Serializes signaling work for this peer, so an offer and its candidates never interleave. */
  queue: Promise<void>;
}

/**
 * A full mesh of audio-only peer connections, one per other participant.
 *
 * Every connection carries one sendrecv audio transceiver from the start. A listener simply has
 * no track on its sender; when promoted, `setLocalTrack` attaches the microphone with
 * replaceTrack, which needs no renegotiation. Switching microphones works the same way.
 */
export class Mesh {
  private readonly peers = new Map<string, Peer>();
  private localTrack: MediaStreamTrack | null = null;

  constructor(
    private readonly ice: { iceServers: IceServer[]; iceTransportPolicy: RTCIceTransportPolicy },
    private readonly events: MeshEvents,
  ) {}

  /** Starts a connection to a peer who was here first. The newcomer always makes the offer. */
  call(peerId: string): void {
    const peer = this.create(peerId);
    this.enqueue(peer, async () => {
      const transceiver = peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
      peer.sender = transceiver.sender;
      if (this.localTrack) await transceiver.sender.replaceTrack(this.localTrack);
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      this.events.signal(peerId, { description: peer.pc.localDescription!.toJSON() });
    });
  }

  handleSignal(from: string, payload: SignalPayload): void {
    if ('description' in payload) {
      const description = payload.description as RTCSessionDescriptionInit;
      const peer = this.peers.get(from) ?? (description.type === 'offer' ? this.create(from) : undefined);
      if (!peer) return;
      this.enqueue(peer, async () => {
        await peer.pc.setRemoteDescription(description);
        for (const candidate of peer.pending.splice(0)) {
          await peer.pc.addIceCandidate(candidate).catch(() => {});
        }
        if (description.type !== 'offer') return;
        const transceiver = peer.pc.getTransceivers()[0];
        if (transceiver) {
          transceiver.direction = 'sendrecv';
          peer.sender = transceiver.sender;
          if (this.localTrack) await transceiver.sender.replaceTrack(this.localTrack);
        }
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        this.events.signal(from, { description: peer.pc.localDescription!.toJSON() });
      });
    } else {
      const peer = this.peers.get(from);
      if (!peer) return;
      const candidate = payload.candidate as RTCIceCandidateInit;
      this.enqueue(peer, async () => {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate).catch(() => {});
        else peer.pending.push(candidate);
      });
    }
  }

  /** Sends `track` (or nothing) to every peer. */
  async setLocalTrack(track: MediaStreamTrack | null): Promise<void> {
    this.localTrack = track;
    await Promise.all(
      [...this.peers.values()].map(
        (peer) => peer.sender?.replaceTrack(track).catch(() => {}) ?? Promise.resolve(),
      ),
    );
  }

  /** The receiver for each peer, for reading remote audio levels. */
  receivers(): [string, RTCRtpReceiver][] {
    const result: [string, RTCRtpReceiver][] = [];
    for (const [peerId, peer] of this.peers) {
      const receiver = peer.pc.getReceivers()[0];
      if (receiver) result.push([peerId, receiver]);
    }
    return result;
  }

  hangUp(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.pc.close();
    this.peers.delete(peerId);
  }

  close(): void {
    for (const peerId of [...this.peers.keys()]) this.hangUp(peerId);
  }

  private create(peerId: string): Peer {
    this.hangUp(peerId);
    const pc = new RTCPeerConnection(this.ice);
    const peer: Peer = { pc, sender: null, pending: [], queue: Promise.resolve() };
    pc.onicecandidate = (event) => {
      if (event.candidate) this.events.signal(peerId, { candidate: event.candidate.toJSON() });
    };
    pc.ontrack = (event) => {
      this.events.track(peerId, event.streams[0] ?? new MediaStream([event.track]));
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(peerId) === peer) this.events.state(peerId, pc.connectionState);
    };
    this.peers.set(peerId, peer);
    return peer;
  }

  private enqueue(peer: Peer, task: () => Promise<void>): void {
    peer.queue = peer.queue.then(task).catch((err: unknown) => {
      console.warn('DevsBooth: signaling step failed', err);
    });
  }
}
