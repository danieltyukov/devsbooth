import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientConfig, ClientToServerEvents, Role, ServerToClientEvents } from '@devsbooth/shared';
import { LevelStore, LocalMeter } from './levels';
import { Mesh } from './mesh';
import { initialRoomState, roomReducer, selectSelf } from './room-state';

type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type MicStatus = 'off' | 'requesting' | 'on' | 'denied' | 'unavailable';

const LEVEL_INTERVAL_MS = 100;
/** A source that has not delivered audio for this long is silent (Opus stops sending when muted). */
const STALE_SOURCE_MS = 400;

/** Loudest recent level among a receiver's sources. */
function receiverLevel(receiver: RTCRtpReceiver): number {
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

const CONNECT_ERRORS: Record<string, string> = {
  unauthorized: 'Your session has ended. Sign in again to join.',
  forbidden: 'Finish setting up your profile before joining a room.',
};

async function openMicrophone(deviceId: string | undefined): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

/**
 * Joins a room and runs everything that keeps you in it: the signaling socket, the peer
 * connections, your microphone, and the audio levels behind the meters.
 */
export function useRoomSession(
  roomId: string,
  ice: Pick<ClientConfig, 'iceServers' | 'iceTransportPolicy'> | undefined,
) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [mic, setMic] = useState<{ status: MicStatus; deviceId?: string; error?: string }>({ status: 'off' });
  const [levels] = useState(() => new LevelStore());

  const socketRef = useRef<RoomSocket | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<LocalMeter | null>(null);
  const mutedRef = useRef(true);
  const deviceRef = useRef<string | undefined>(undefined);
  /** Bumped on every microphone request so a slow, outdated request cannot win. */
  const micRequestRef = useRef(0);
  /** Peers who are muted or listening, whose meters stay dark whatever the receiver reports. */
  const silentRef = useRef(new Set<string>());

  const releaseMicrophone = useCallback(() => {
    micRequestRef.current++;
    meterRef.current?.close();
    meterRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void meshRef.current?.setLocalTrack(null);
  }, []);

  const acquireMicrophone = useCallback(async (deviceId: string | undefined) => {
    const request = ++micRequestRef.current;
    setMic((current) => ({
      status: current.status === 'on' ? 'on' : 'requesting',
      deviceId: current.deviceId,
    }));
    try {
      const stream = await openMicrophone(deviceId);
      if (request !== micRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = stream.getAudioTracks()[0]!;
      track.enabled = !mutedRef.current;
      meterRef.current?.close();
      streamRef.current?.getTracks().forEach((old) => old.stop());
      streamRef.current = stream;
      meterRef.current = new LocalMeter(stream);
      deviceRef.current = deviceId ?? track.getSettings().deviceId;
      await meshRef.current?.setLocalTrack(track);
      setMic({ status: 'on', deviceId: deviceRef.current });
    } catch (err) {
      if (request !== micRequestRef.current) return;
      // Switching failed but the previous microphone still works: keep it, so mute keeps working.
      const working = streamRef.current?.getAudioTracks()[0];
      if (working && working.readyState === 'live') {
        deviceRef.current = working.getSettings().deviceId;
        setMic({
          status: 'on',
          deviceId: deviceRef.current,
          error: 'That microphone could not be opened, so you are still on the previous one.',
        });
        return;
      }
      const name = (err as DOMException).name;
      setMic({ status: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable' });
    }
  }, []);

  const applyRole = useCallback(
    (role: Role) => {
      if (role === 'speaker' && !streamRef.current) void acquireMicrophone(deviceRef.current);
      if (role === 'listener') {
        mutedRef.current = true;
        releaseMicrophone();
        setMic({ status: 'off' });
      }
    },
    [acquireMicrophone, releaseMicrophone],
  );

  // The socket and the mesh live as long as you are in this room.
  useEffect(() => {
    if (!ice) return;
    const socket: RoomSocket = io({ transports: ['websocket'], autoConnect: false });
    const mesh = new Mesh(
      { iceServers: ice.iceServers, iceTransportPolicy: ice.iceTransportPolicy },
      {
        signal: (to, payload) => socket.emit('rtc:signal', { to, ...payload }),
        track: (peerId, stream) => setRemoteStreams((current) => ({ ...current, [peerId]: stream })),
        state: (peerId, connection) => dispatch({ type: 'connection', peerId, state: connection }),
      },
    );
    socketRef.current = socket;
    meshRef.current = mesh;
    let active = true;

    const forget = (peerId: string) => {
      mesh.hangUp(peerId);
      levels.delete(peerId);
      setRemoteStreams(({ [peerId]: _gone, ...rest }) => rest);
    };

    const stop = () => {
      active = false;
      mesh.close();
      setRemoteStreams({});
      releaseMicrophone();
      socket.disconnect();
    };

    // Runs on the first connection and again after a reconnect, which brings a new peer id.
    socket.on('connect', () => {
      mesh.close();
      setRemoteStreams({});
      dispatch({ type: 'connecting' });
      socket.emit('room:join', { roomId }, (result) => {
        if (!active) return;
        if (!result.ok) {
          dispatch({ type: 'failed', error: result.error });
          stop();
          return;
        }
        mutedRef.current = true;
        if (streamRef.current) streamRef.current.getAudioTracks().forEach((track) => (track.enabled = false));
        dispatch({ type: 'joined', room: result.room, self: result.self, participants: result.participants });
        applyRole(result.self.role);
        for (const participant of result.participants) mesh.call(participant.peerId);
      });
    });
    socket.on('connect_error', (err) => {
      const message = CONNECT_ERRORS[err.message];
      if (message) {
        dispatch({ type: 'failed', error: { code: 'unauthorized', message } });
        stop();
      }
      // Anything else is a network problem; socket.io keeps retrying.
    });
    socket.on('peer:joined', (participant) => dispatch({ type: 'peer-joined', participant }));
    socket.on('peer:left', ({ peerId }) => {
      forget(peerId);
      dispatch({ type: 'peer-left', peerId });
    });
    socket.on('peer:updated', (patch) => {
      dispatch({ type: 'peer-updated', patch });
      if (patch.peerId !== socket.id) return;
      if (patch.muted !== undefined) {
        mutedRef.current = patch.muted;
        streamRef.current?.getAudioTracks().forEach((track) => (track.enabled = !patch.muted));
      }
      if (patch.role) applyRole(patch.role);
    });
    socket.on('rtc:signal', ({ from, ...payload }) => mesh.handleSignal(from, payload));
    socket.on('room:ended', () => {
      dispatch({ type: 'ended' });
      stop();
    });
    socket.on('room:kicked', () => {
      dispatch({ type: 'kicked' });
      stop();
    });
    socket.connect();

    return () => {
      if (socket.connected) socket.emit('room:leave');
      stop();
      socketRef.current = null;
      meshRef.current = null;
    };
  }, [roomId, ice, levels, applyRole, releaseMicrophone]);

  useEffect(() => {
    silentRef.current = new Set(
      state.participants.filter((p) => p.muted || p.role === 'listener').map((p) => p.peerId),
    );
  }, [state.participants]);

  // Audio levels for the meters and the speaking indicators.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const mesh = meshRef.current;
      const selfId = socketRef.current?.id;
      if (!mesh) return;
      for (const [peerId, receiver] of mesh.receivers()) {
        levels.set(peerId, silentRef.current.has(peerId) ? 0 : receiverLevel(receiver));
      }
      if (selfId) levels.set(selfId, meterRef.current && !mutedRef.current ? meterRef.current.read() : 0);
    }, LEVEL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [levels]);

  const setMuted = useCallback((muted: boolean) => {
    const socket = socketRef.current;
    if (!socket) return;
    meterRef.current?.resume();
    mutedRef.current = muted;
    streamRef.current?.getAudioTracks().forEach((track) => (track.enabled = !muted));
    socket.emit('mic:set', { muted });
  }, []);

  const setHandRaised = useCallback((raised: boolean) => {
    socketRef.current?.emit('hand:set', { raised });
  }, []);

  const setRole = useCallback(
    (peerId: string, role: Role) =>
      new Promise<string | null>((resolve) => {
        const socket = socketRef.current;
        if (!socket) return resolve('You are not connected.');
        socket.emit('role:set', { peerId, role }, (result) =>
          resolve(result.ok ? null : result.error.message),
        );
      }),
    [],
  );

  const switchMicrophone = useCallback(
    (deviceId: string) => {
      deviceRef.current = deviceId;
      void acquireMicrophone(deviceId);
    },
    [acquireMicrophone],
  );

  const retryMicrophone = useCallback(() => void acquireMicrophone(deviceRef.current), [acquireMicrophone]);

  return {
    state,
    self: selectSelf(state),
    remoteStreams,
    levels,
    mic,
    setMuted,
    setHandRaised,
    setRole,
    switchMicrophone,
    retryMicrophone,
  };
}
