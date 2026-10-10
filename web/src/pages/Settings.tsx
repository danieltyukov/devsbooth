import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api, errorMessage } from '../api/client';
import { useMe } from '../api/queries';
import { Button } from '../components/Button';
import { Notice } from '../components/Notice';
import { ProfileForm } from '../components/ProfileForm';
import styles from './Form.module.css';

export function Settings() {
  const { data: me } = useMe();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;

  async function signOut() {
    try {
      await api('/auth/logout', { method: 'POST' });
      client.clear();
      client.setQueryData(['me'], null);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className={`container ${styles.page}`}>
      <h1 className={styles.title}>Your profile</h1>
      <p className={styles.lede}>Signed in as {me.email}.</p>
      <ProfileForm me={me} submitLabel="Save changes" />
      <div className={styles.form}>
        {error && <Notice tone="error">{error}</Notice>}
        <div>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
