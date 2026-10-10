import { useRef, useState, type FormEvent } from 'react';
import { AVATAR_TYPES, LIMITS, type Me } from '@devsbooth/shared';
import { api, ApiError, errorMessage } from '../api/client';
import { useSetMe } from '../api/queries';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { Field } from './Field';
import { Notice } from './Notice';
import styles from './ProfileForm.module.css';

interface Props {
  me: Me;
  submitLabel: string;
  onSaved?: (me: Me) => void;
}

export function ProfileForm({ me, submitLabel, onSaved }: Props) {
  const setMe = useSetMe();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(me.name ?? '');
  const [username, setUsername] = useState(me.username ?? '');
  const [bio, setBio] = useState(me.bio);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const { user } = await api<{ user: Me }>('/me', { method: 'PATCH', json: { name, username, bio } });
      setMe(user);
      setSaved(true);
      onSaved?.(user);
    } catch (err) {
      setError({ message: errorMessage(err), fields: err instanceof ApiError ? err.fields : {} });
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File) {
    setAvatarError(null);
    if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) {
      setAvatarError('Use a PNG, JPEG, WebP or GIF image.');
      return;
    }
    if (file.size > LIMITS.avatarBytesMax) {
      setAvatarError('That image is over 5 MB. Try a smaller one.');
      return;
    }
    setUploading(true);
    try {
      const { user } = await api<{ user: Me }>('/me/avatar', { method: 'PUT', body: file });
      setMe(user);
    } catch (err) {
      setAvatarError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function removeAvatar() {
    setAvatarError(null);
    try {
      const { user } = await api<{ user: Me }>('/me/avatar', { method: 'DELETE' });
      setMe(user);
    } catch (err) {
      setAvatarError(errorMessage(err));
    }
  }

  return (
    <form className={styles.form} onSubmit={save} noValidate>
      <div className={styles.photo}>
        <Avatar name={name || me.email} src={me.avatarUrl} size={88} shape="square" />
        <div className={styles.photoActions}>
          <input
            ref={fileInput}
            type="file"
            accept={AVATAR_TYPES.join(',')}
            className="visually-hidden"
            id="avatar-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = '';
            }}
          />
          <Button variant="secondary" busy={uploading} onClick={() => fileInput.current?.click()}>
            {me.avatarUrl ? 'Change photo' : 'Add a photo'}
          </Button>
          {me.avatarUrl && (
            <Button variant="ghost" onClick={removeAvatar}>
              Remove
            </Button>
          )}
          <p className={styles.photoHint}>Optional. Square images look best.</p>
          {avatarError && <p className={styles.photoError}>{avatarError}</p>}
        </div>
      </div>

      <Field
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoComplete="name"
        maxLength={LIMITS.nameMax}
        error={error?.fields.name}
        required
      />
      <Field
        label="Username"
        lead="@"
        value={username}
        onChange={(event) => setUsername(event.target.value.toLowerCase())}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={LIMITS.usernameMax}
        hint="Letters, digits and underscores. Your profile lives at /u/username."
        error={error?.fields.username}
        required
      />
      <Field
        label="Bio"
        value={bio}
        onChange={(event) => setBio(event.target.value)}
        maxLength={LIMITS.bioMax}
        placeholder="What do you work on?"
        hint={`Optional, up to ${LIMITS.bioMax} characters.`}
        error={error?.fields.bio}
      />

      {error && Object.keys(error.fields).length === 0 && <Notice tone="error">{error.message}</Notice>}
      {saved && !onSaved && <Notice>Profile saved.</Notice>}

      <div>
        <Button type="submit" size="l" busy={saving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
