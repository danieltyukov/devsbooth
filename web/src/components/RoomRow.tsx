import { Globe, Lock, Users } from 'lucide-react';
import { Link } from 'react-router';
import type { RoomSummary } from '@devsbooth/shared';
import { Avatar } from './Avatar';
import styles from './RoomRow.module.css';

const TYPE_LABEL = { open: 'Open', social: 'Followers', private: 'Private' } as const;
const TYPE_ICON = { open: Globe, social: Users, private: Lock } as const;

function speakerLine(room: RoomSummary): string {
  const names = room.speakers.map((speaker) => speaker.name);
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

export function RoomRow({ room }: { room: RoomSummary }) {
  const live = room.participantCount > 0;
  const TypeIcon = TYPE_ICON[room.type];
  return (
    <li className={styles.row} data-live={live}>
      <span className={styles.lamp} aria-hidden="true" />
      <div className={styles.main}>
        <Link to={`/r/${room.id}`} className={styles.topic}>
          {room.topic}
        </Link>
        <p className={styles.meta}>
          <span className={styles.type}>
            <TypeIcon aria-hidden="true" />
            {TYPE_LABEL[room.type]}
          </span>
          <span>{speakerLine(room)}</span>
        </p>
      </div>
      <div className={styles.side}>
        <span className={styles.faces} aria-hidden="true">
          {room.speakers.slice(0, 4).map((speaker) => (
            <Avatar key={speaker.id} name={speaker.name} src={speaker.avatarUrl} size={30} />
          ))}
        </span>
        <span className={styles.count}>
          {live ? `${room.participantCount} in the room` : 'Nobody here yet'}
        </span>
      </div>
    </li>
  );
}
