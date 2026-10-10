import { useDeferredValue, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { errorMessage } from '../api/client';
import { useRooms } from '../api/queries';
import { Button } from '../components/Button';
import { CreateRoomDialog } from '../components/CreateRoomDialog';
import { Notice } from '../components/Notice';
import { RoomRow } from '../components/RoomRow';
import styles from './Rooms.module.css';

export function Rooms() {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const deferred = useDeferredValue(query.trim());
  const rooms = useRooms(deferred);

  return (
    <div className="container">
      <div className={styles.head}>
        <h1 className={styles.title}>Rooms</h1>
        <div className={styles.tools}>
          <label className={styles.search}>
            <Search aria-hidden="true" />
            <span className="visually-hidden">Search rooms by topic</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search topics"
            />
          </label>
          <Button icon={<Plus aria-hidden="true" />} onClick={() => setCreating(true)}>
            Start a room
          </Button>
        </div>
      </div>

      {rooms.error && <Notice tone="error">{errorMessage(rooms.error)}</Notice>}

      {rooms.data && rooms.data.length > 0 && (
        <ul
          className={styles.list}
          aria-label="Rooms"
          aria-busy={rooms.isFetching && deferred !== query.trim()}
        >
          {rooms.data.map((room) => (
            <RoomRow key={room.id} room={room} />
          ))}
        </ul>
      )}

      {rooms.data && rooms.data.length === 0 && (
        <div className={styles.empty}>
          {deferred ? (
            <p>No rooms match “{deferred}”.</p>
          ) : (
            <>
              <p className={styles.emptyTitle}>No rooms are open right now.</p>
              <p>Start one and the people you know can drop in.</p>
              <Button icon={<Plus aria-hidden="true" />} onClick={() => setCreating(true)}>
                Start a room
              </Button>
            </>
          )}
        </div>
      )}

      <CreateRoomDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
