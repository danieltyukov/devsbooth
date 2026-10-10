import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientConfig,
  ClientToServerEvents,
  Role,
  RoomSummary,
  ServerToClientEvents,
} from '@devsbooth/shared';
import { LevelStore, LocalMeter } from './levels';
import { Mesh } from './mesh';
import { connectSfu } from './sfu';
import type { MediaEvents, MediaTransport } from './transport';
import { initialRoomState, roomReducer, selectSelf } from './room-state';

type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type MicStatus = 'off' | 'requesting' | 'on' | 'denied' | 'unavailable';

const LEVEL_INTERVAL_MS = 100;
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
export function useRoomSession(roomId: string, media: ClientConfig | undefined) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [mic, setMic] = useState<{ status: MicStatus; deviceId?: string; error?: string }>({ status: 'off' });
  const [levels] = useState(() => new LevelStore());

  const socketRef = useRef<RoomSocket | null>(null);
  const transportRef = useRef<MediaTransport | null>(null);
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
    void transportRef.current?.setLocalTrack(null);
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
      await transportRef.current?.setLocalTrack(track);
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

  // The socket and the audio transport live as long as you are in this room.
  useEffect(() => {
    if (!media) return;
    const socket: RoomSocket = io({ transports: ['websocket'], autoConnect: false });
    socketRef.current = socket;
    let active = true;
    /** Bumped on every join, so a slow SFU connection from an earlier join is thrown away. */
    let joinCount = 0;

    const events: MediaEvents = {
      track: (peerId, stream) => setRemoteStreams((current) => ({ ...current, [peerId]: stream })),
      state: (peerId, connection) => dispatch({ type: 'connection', peerId, state: connection }),
    };

    const closeTransport = () => {
      transportRef.current?.close();
      transportRef.current = null;
      setRemoteStreams({});
    };

    /** Starts sending the microphone, if there is one, once a transport exists. */
    const attach = (transport: MediaTransport) => {
      transportRef.current = transport;
      const track = streamRef.current?.getAudioTracks()[0];
      if (track) void transport.setLocalTrack(track);
    };

    const forget = (peerId: string) => {
      transportRef.current?.hangUp(peerId);
      levels.delete(peerId);
      setRemoteStreams(({ [peerId]: _gone, ...rest }) => rest);
    };

    const stop = () => {
      active = false;
      closeTransport();
      releaseMicrophone();
      socket.disconnect();
    };

    // Runs on the first connection and again after a reconnect, which brings a new peer id.
    socket.on('connect', () => {
      const join = ++joinCount;
      closeTransport();
      dispatch({ type: 'connecting' });
      socket.emit('room:join', { roomId }, async (result) => {
        if (!active || join !== joinCount) return;
        if (!result.ok) {
          dispatch({ type: 'failed', error: result.error });
          stop();
          return;
        }
        mutedRef.current = true;
        if (streamRef.current) streamRef.current.getAudioTracks().forEach((track) => (track.enabled = false));
        dispatch({ type: 'joined', room: result.room, self: result.self, participants: result.participants });
        applyRole(result.self.role);

        if (media.media === 'sfu' && media.sfuUrl && result.sfuToken) {
          try {
            const transport = await connectSfu(media.sfuUrl, result.sfuToken, events);
            if (!active || join !== joinCount) return transport.close();
            attach(transport);
          } catch {
            dispatch({
              type: 'failed',
              error: {
                code: 'connection',
                message: 'Could not reach the audio server. Try again in a moment.',
              },
            });
            stop();
          }
          return;
        }
        const mesh = new Mesh(
          { iceServers: media.iceServers, iceTransportPolicy: media.iceTransportPolicy },
          { ...events, signal: (to, payload) => socket.emit('rtc:signal', { to, ...payload }) },
        );
        attach(mesh);
        for (const participant of result.participants) mesh.peerPresent(participant.peerId);
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
    socket.on('rtc:signal', ({ from, ...payload }) => transportRef.current?.handleSignal(from, payload));
    socket.on('media:token', ({ token }) => transportRef.current?.updateToken(token));
    socket.on('room:updated', (patch) => dispatch({ type: 'room-updated', patch }));
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
    };
  }, [roomId, media, levels, applyRole, releaseMicrophone]);

  useEffect(() => {
    silentRef.current = new Set(
      state.participants.filter((p) => p.muted || p.role === 'listener').map((p) => p.peerId),
    );
  }, [state.participants]);

  // Audio levels for the meters and the speaking indicators.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const transport = transportRef.current;
      const selfId = socketRef.current?.id;
      if (!transport) return;
      for (const [peerId, level] of transport.levels()) {
        levels.set(peerId, silentRef.current.has(peerId) ? 0 : level);
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

  /** Applies a change the host just saved, before the broadcast arrives. */
  const updateRoom = useCallback(
    (patch: Partial<Pick<RoomSummary, 'topic'>>) => dispatch({ type: 'room-updated', patch }),
    [],
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
    updateRoom,
  };
}
