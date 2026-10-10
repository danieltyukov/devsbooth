import { useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import { LIMITS, type RoomSummary } from '@devsbooth/shared';
import { api, ApiError, errorMessage } from '../api/client';
import { Button } from './Button';
import { Field } from './Field';
import styles from './TopicEditor.module.css';

interface Props {
  roomId: string;
  topic: string;
  onSaved: (topic: string) => void;
}

/** Lets the host rename the room in place. Everyone else sees the change through the room socket. */
export function TopicEditor({ roomId, topic, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(topic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!editing) {
    return (
      <Button
        variant="ghost"
        icon={<Pencil aria-hidden="true" />}
        onClick={() => {
          setValue(topic);
          setError(undefined);
          setEditing(true);
        }}
      >
        Edit topic
      </Button>
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const { room } = await api<{ room: RoomSummary }>(`/rooms/${roomId}`, {
        method: 'PATCH',
        json: { topic: value },
      });
      onSaved(room.topic);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.topic ?? err.message) : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={save} noValidate>
      <Field
        label="New topic"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        minLength={LIMITS.topicMin}
        maxLength={LIMITS.topicMax}
        required
        autoFocus
        error={error}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setEditing(false);
        }}
      />
      <div className={styles.actions}>
        <Button type="submit" busy={busy}>
          Save topic
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
