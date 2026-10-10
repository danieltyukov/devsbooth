import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Globe, Lock, Users } from 'lucide-react';
import { useNavigate } from 'react-router';
import { LIMITS, type RoomSummary, type RoomType } from '@devsbooth/shared';
import { api, ApiError, errorMessage } from '../api/client';
import { Button } from './Button';
import { Field } from './Field';
import { Notice } from './Notice';
import styles from './CreateRoomDialog.module.css';

const TYPES: { value: RoomType; label: string; detail: string; Icon: typeof Globe }[] = [
  { value: 'open', label: 'Open', detail: 'Listed for everyone. Anyone signed in can join.', Icon: Globe },
  { value: 'social', label: 'Followers', detail: 'Listed for people who follow you.', Icon: Users },
  { value: 'private', label: 'Private', detail: 'Not listed. People join with the link.', Icon: Lock },
];

export function CreateRoomDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [type, setType] = useState<RoomType>('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { room } = await api<{ room: RoomSummary }>('/rooms', { json: { topic, type } });
      onClose();
      navigate(`/r/${room.id}`);
    } catch (err) {
      setError({ message: errorMessage(err), fields: err instanceof ApiError ? err.fields : {} });
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className={styles.dialog} onClose={onClose} aria-labelledby="create-room-title">
      <form className={styles.form} onSubmit={submit}>
        <h2 id="create-room-title" className={styles.title}>
          Start a room
        </h2>
        <Field
          label="Topic"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="What do you want to talk about?"
          minLength={LIMITS.topicMin}
          maxLength={LIMITS.topicMax}
          required
          autoFocus
          error={error?.fields.topic}
        />
        <fieldset className={styles.types}>
          <legend className={styles.legend}>Who can find it</legend>
          {TYPES.map(({ value, label, detail, Icon }) => (
            <label key={value} className={styles.type}>
              <input
                type="radio"
                name="type"
                value={value}
                checked={type === value}
                onChange={() => setType(value)}
              />
              <Icon aria-hidden="true" className={styles.typeIcon} />
              <span className={styles.typeText}>
                <span className={styles.typeLabel}>{label}</span>
                <span className={styles.typeDetail}>{detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error && !error.fields.topic && <Notice tone="error">{error.message}</Notice>}
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Open the room
          </Button>
        </div>
      </form>
    </dialog>
  );
}
