import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import type { Profile as ProfileData } from '@devsbooth/shared';
import { api, ApiError, errorMessage } from '../api/client';
import { keys, useHostedRooms, useProfile } from '../api/queries';
import { Avatar } from '../components/Avatar';
import { Button, ButtonLink } from '../components/Button';
import { FullPageMessage } from '../components/FullPageMessage';
import { Notice } from '../components/Notice';
import { RoomRow } from '../components/RoomRow';
import styles from './Profile.module.css';

function count(n: number, one: string, many: string) {
  return (
    <>
      <span className={styles.number}>{n}</span> {n === 1 ? one : many}
    </>
  );
}

export function Profile() {
  const { username = '' } = useParams();
  const profile = useProfile(username);
  const hosted = useHostedRooms(username);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (profile.error) {
    const missing = profile.error instanceof ApiError && profile.error.status === 404;
    return (
      <FullPageMessage
        title={missing ? 'No one by that name' : 'Could not load this profile'}
        actions={<ButtonLink to="/rooms">Back to rooms</ButtonLink>}
      >
        {missing ? `There is no one with the username @${username}.` : errorMessage(profile.error)}
      </FullPageMessage>
    );
  }
  if (!profile.data) return <FullPageMessage title="Loading profile" quiet />;
  const p = profile.data;

  async function toggleFollow() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ profile: ProfileData }>(`/users/${p.username}/follow`, {
        method: p.isFollowing ? 'DELETE' : 'PUT',
      });
      client.setQueryData(keys.profile(p.username), res.profile);
      // Following changes which social rooms you can see.
      void client.invalidateQueries({ queryKey: ['rooms'] });
      void client.invalidateQueries({ queryKey: keys.hosted(p.username) });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.card}>
        <Avatar name={p.name} src={p.avatarUrl} size={128} shape="square" />
        <div className={styles.info}>
          <h1 className={styles.name}>{p.name}</h1>
          <p className={styles.handle}>@{p.username}</p>
          {p.bio && <p className={styles.bio}>{p.bio}</p>}
          <p className={styles.counts}>
            <span>{count(p.followers, 'follower', 'followers')}</span>
            <span>{count(p.following, 'following', 'following')}</span>
          </p>
          <div className={styles.actions}>
            {p.isMe ? (
              <ButtonLink to="/settings" variant="secondary">
                Edit profile
              </ButtonLink>
            ) : (
              <Button
                variant={p.isFollowing ? 'secondary' : 'primary'}
                busy={busy}
                aria-pressed={p.isFollowing}
                onClick={toggleFollow}
              >
                {p.isFollowing ? 'Unfollow' : 'Follow'}
              </Button>
            )}
          </div>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </div>

      {hosted.data && hosted.data.length > 0 && (
        <section className={styles.rooms} aria-labelledby="hosted-title">
          <h2 id="hosted-title" className={styles.roomsTitle}>
            {p.isMe ? 'Your open rooms' : 'Hosting now'}
          </h2>
          <ul className={styles.roomList}>
            {hosted.data.map((room) => (
              <RoomRow key={room.id} room={room} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
