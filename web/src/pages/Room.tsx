import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Hand, Link2, Mic, MicOff, Volume2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ClientConfig, Participant, Role } from '@devsbooth/shared';
import { api, errorMessage } from '../api/client';
import { useClientConfig } from '../api/queries';
import { Avatar } from '../components/Avatar';
import { Button, ButtonLink } from '../components/Button';
import { FullPageMessage } from '../components/FullPageMessage';
import { LevelMeter } from '../components/LevelMeter';
import { Notice } from '../components/Notice';
import { useAudioInputs } from '../rtc/devices';
import { useLevel, type LevelStore } from '../rtc/levels';
import { selectStage } from '../rtc/room-state';
import { useRoomSession } from '../rtc/useRoomSession';
import styles from './Room.module.css';

const FAILURE_TITLES: Record<string, string> = {
  room_ended: 'This room has ended',
  forbidden: 'This room is for followers',
  room_full: 'This room is full',
  unauthorized: 'Sign in again',
};

export function RoomPage() {
  const { roomId = '' } = useParams();
  const config = useClientConfig();
  // Changing the key remounts the session, which rejoins the room.
  const [attempt, setAttempt] = useState(0);

  if (config.error) {
    return <FullPageMessage title="Could not join">{errorMessage(config.error)}</FullPageMessage>;
  }
  if (!config.data) return <FullPageMessage title="Joining the room" quiet />;
  return (
    <RoomSession
      key={`${roomId}:${attempt}`}
      roomId={roomId}
      ice={config.data}
      onRejoin={() => setAttempt((n) => n + 1)}
    />
  );
}

interface RemoteAudioProps {
  stream: MediaStream;
  /** Whether the server says this peer may be heard right now: an unmuted speaker. */
  audible: boolean;
  onBlocked: () => void;
}

/**
 * Plays one peer's audio. Audio travels peer to peer, so a modified client could send sound
 * while listed as a listener or muted; every receiver therefore plays a peer only while the
 * server's room state says they are an unmuted speaker.
 */
function RemoteAudio({ stream, audible, onBlocked }: RemoteAudioProps) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    element.play().catch(() => onBlocked());
  }, [stream, onBlocked]);
  useEffect(() => {
    if (ref.current) ref.current.muted = !audible;
  }, [audible]);
  return <audio ref={ref} autoPlay muted={!audible} data-remote-audio data-audible={audible} />;
}

interface TileProps {
  participant: Participant;
  store: LevelStore;
  isSelf: boolean;
  isOwner: boolean;
  viewerIsHost: boolean;
  connection: RTCPeerConnectionState | undefined;
  onRole: (peerId: string, role: Role) => void;
}

function ParticipantTile({
  participant,
  store,
  isSelf,
  isOwner,
  viewerIsHost,
  connection,
  onRole,
}: TileProps) {
  const { speaking } = useLevel(store, participant.peerId);
  const speaker = participant.role === 'speaker';
  const name = participant.user.name;
  return (
    <li
      className={speaker ? styles.strip : styles.seat}
      data-testid="participant"
      data-username={participant.user.username}
      data-role={participant.role}
      data-muted={participant.muted}
      data-hand={participant.handRaised}
      data-speaking={speaking}
      data-connection={isSelf ? 'self' : (connection ?? 'new')}
    >
      <div className={styles.face}>
        <Avatar
          name={name}
          src={participant.user.avatarUrl}
          size={speaker ? 88 : 56}
          shape={speaker ? 'square' : 'round'}
        />
        {speaker && <LevelMeter store={store} peerId={participant.peerId} />}
        {participant.handRaised && (
          <span className={styles.hand} title="Hand raised">
            <Hand aria-hidden="true" />
          </span>
        )}
      </div>
      <div className={styles.label}>
        <Link to={`/u/${participant.user.username}`} className={styles.name}>
          {name}
          {isSelf && <span className={styles.you}> (you)</span>}
        </Link>
        <span className={styles.status}>
          {isOwner && <span className={styles.hostTag}>Host</span>}
          {speaker &&
            (participant.muted ? (
              <MicOff aria-label="Muted" className={styles.micOff} />
            ) : (
              <Mic aria-label="Mic on" className={styles.micOn} />
            ))}
          {!isSelf && connection === 'failed' && <span className={styles.lost}>No audio link</span>}
        </span>
      </div>
      {viewerIsHost && !isOwner && (
        <button
          type="button"
          className={styles.roleButton}
          onClick={() => onRole(participant.peerId, speaker ? 'listener' : 'speaker')}
        >
          {speaker ? 'Move to audience' : 'Invite to speak'}
        </button>
      )}
    </li>
  );
}

interface SessionProps {
  roomId: string;
  ice: ClientConfig;
  onRejoin: () => void;
}

function RoomSession({ roomId, ice, onRejoin }: SessionProps) {
  const navigate = useNavigate();
  const session = useRoomSession(roomId, ice);
  const { state, self, levels, mic } = session;
  const inputs = useAudioInputs(mic.status === 'on');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const onAudioBlocked = useCallback(() => setAudioBlocked(true), []);

  const endRoom = useMutation({
    mutationFn: () => api(`/rooms/${roomId}`, { method: 'DELETE' }),
    onError: (err) => setNotice(errorMessage(err)),
  });

  useEffect(() => {
    if (state.room) document.title = `${state.room.topic} - DevsBooth`;
    return () => {
      document.title = 'DevsBooth';
    };
  }, [state.room]);

  useEffect(() => {
    if (!confirmEnd) return;
    const timer = window.setTimeout(() => setConfirmEnd(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmEnd]);

  if (state.status === 'failed') {
    return (
      <FullPageMessage
        title={FAILURE_TITLES[state.error?.code ?? ''] ?? 'Could not join'}
        actions={<ButtonLink to="/rooms">Back to rooms</ButtonLink>}
      >
        {state.error?.message}
      </FullPageMessage>
    );
  }
  if (state.status === 'ended') {
    return (
      <FullPageMessage
        title="This room has ended"
        actions={<ButtonLink to="/rooms">Back to rooms</ButtonLink>}
      >
        The host closed the room. Thanks for being there.
      </FullPageMessage>
    );
  }
  if (state.status === 'kicked') {
    return (
      <FullPageMessage
        title="You are in this room in another tab"
        actions={
          <>
            <Button onClick={onRejoin}>Rejoin here</Button>
            <ButtonLink to="/rooms" variant="secondary">
              Back to rooms
            </ButtonLink>
          </>
        }
      >
        You can only be in a room once, so the newest tab took over.
      </FullPageMessage>
    );
  }
  if (state.status === 'connecting' || !state.room || !self) {
    return <FullPageMessage title="Joining the room" quiet />;
  }

  const room = state.room;
  const viewerIsHost = self.user.id === room.owner.id;
  const { speakers, audience } = selectStage(state);
  const raisedHands = audience.filter((p) => p.handRaised).length;

  async function changeRole(peerId: string, role: Role) {
    const problem = await session.setRole(peerId, role);
    setNotice(problem);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/r/${room.id}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setNotice(`Copy this link to invite people: ${window.location.origin}/r/${room.id}`);
    }
  }

  function enableSound() {
    document.querySelectorAll<HTMLAudioElement>('audio[data-remote-audio]').forEach((element) => {
      void element.play().catch(() => {});
    });
    setAudioBlocked(false);
  }

  const tile = (participant: Participant) => (
    <ParticipantTile
      key={participant.peerId}
      participant={participant}
      store={levels}
      isSelf={participant.peerId === self.peerId}
      isOwner={participant.user.id === room.owner.id}
      viewerIsHost={viewerIsHost}
      connection={state.connections[participant.peerId]}
      onRole={changeRole}
    />
  );

  return (
    <div className={styles.page}>
      <div className="container">
        <Link to="/rooms" className={styles.back}>
          <ArrowLeft aria-hidden="true" />
          All rooms
        </Link>
        <header className={styles.header}>
          <h1 className={styles.topic}>{room.topic}</h1>
          <p className={styles.host}>
            <span>
              Hosted by <Link to={`/u/${room.owner.username}`}>{room.owner.name}</Link>
            </span>
            {room.type === 'private' && <span className={styles.typeTag}>Private room</span>}
            {room.type === 'social' && <span className={styles.typeTag}>Followers room</span>}
          </p>
        </header>

        {audioBlocked && (
          <div className={styles.banner}>
            <Notice>
              Your browser paused the audio.{' '}
              <Button variant="secondary" icon={<Volume2 aria-hidden="true" />} onClick={enableSound}>
                Turn on sound
              </Button>
            </Notice>
          </div>
        )}
        {mic.status === 'denied' && (
          <div className={styles.banner}>
            <Notice tone="error">
              Microphone access is blocked, so you can listen but not talk. Allow the microphone in your
              browser&apos;s site settings, then{' '}
              <button type="button" className={styles.inlineButton} onClick={session.retryMicrophone}>
                try again
              </button>
              .
            </Notice>
          </div>
        )}
        {mic.status === 'unavailable' && (
          <div className={styles.banner}>
            <Notice tone="error">
              No microphone was found. Plug one in, then pick it from the list below.
            </Notice>
          </div>
        )}
        {notice && (
          <div className={styles.banner}>
            <Notice tone="error">{notice}</Notice>
          </div>
        )}

        <section aria-labelledby="stage-title">
          <h2 id="stage-title" className={styles.sectionTitle}>
            Speakers <span className={styles.count}>{speakers.length}</span>
          </h2>
          <ul className={styles.stage}>{speakers.map(tile)}</ul>
        </section>

        <section aria-labelledby="audience-title">
          <h2 id="audience-title" className={styles.sectionTitle}>
            Audience <span className={styles.count}>{audience.length}</span>
            {viewerIsHost && raisedHands > 0 && (
              <span className={styles.hands}>
                {raisedHands} {raisedHands === 1 ? 'hand' : 'hands'} up
              </span>
            )}
          </h2>
          {audience.length > 0 ? (
            <ul className={styles.audience}>{audience.map(tile)}</ul>
          ) : (
            <p className={styles.quiet}>Nobody is listening yet. Share the link to bring people in.</p>
          )}
        </section>
      </div>

      {Object.entries(session.remoteStreams).map(([peerId, stream]) => {
        const peer = state.participants.find((p) => p.peerId === peerId);
        const audible = peer !== undefined && peer.role === 'speaker' && !peer.muted;
        return <RemoteAudio key={peerId} stream={stream} audible={audible} onBlocked={onAudioBlocked} />;
      })}

      <div className={styles.transport} role="toolbar" aria-label="Room controls">
        <div className={`container ${styles.transportInner}`}>
          <Button variant="secondary" className={styles.leave} onClick={() => navigate('/rooms')}>
            Leave quietly
          </Button>

          <div className={styles.center}>
            {self.role === 'speaker' ? (
              <button
                type="button"
                className={styles.micButton}
                data-live={!self.muted}
                aria-pressed={!self.muted}
                disabled={mic.status !== 'on'}
                onClick={() => session.setMuted(!self.muted)}
              >
                {self.muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
                <span>{mic.status === 'requesting' ? 'Starting mic' : self.muted ? 'Unmute' : 'On air'}</span>
              </button>
            ) : (
              <Button
                variant={self.handRaised ? 'primary' : 'secondary'}
                icon={<Hand aria-hidden="true" />}
                aria-pressed={self.handRaised}
                onClick={() => session.setHandRaised(!self.handRaised)}
              >
                {self.handRaised ? 'Lower hand' : 'Raise hand'}
              </Button>
            )}
            {self.role === 'speaker' && inputs.length > 1 && (
              <label className={styles.device}>
                <span className="visually-hidden">Microphone</span>
                <select
                  value={mic.deviceId ?? ''}
                  onChange={(event) => session.switchMicrophone(event.target.value)}
                >
                  {inputs.map((input) => (
                    <option key={input.deviceId} value={input.deviceId}>
                      {input.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className={styles.right}>
            <Button variant="ghost" icon={<Link2 aria-hidden="true" />} onClick={copyLink}>
              {copied ? 'Link copied' : 'Copy link'}
            </Button>
            {viewerIsHost && (
              <Button
                variant="danger"
                busy={endRoom.isPending}
                onClick={() => (confirmEnd ? endRoom.mutate() : setConfirmEnd(true))}
              >
                {confirmEnd ? 'Confirm: end for everyone' : 'End room'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
