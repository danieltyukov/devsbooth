import { litSegments, useLevel, type LevelStore } from '../rtc/levels';
import styles from './LevelMeter.module.css';

const SEGMENTS = 10;

/** A vertical LED meter, green through amber, like a console channel strip. */
export function LevelMeter({ store, peerId }: { store: LevelStore; peerId: string }) {
  const { level } = useLevel(store, peerId);
  const lit = litSegments(level, SEGMENTS);
  return (
    <div className={styles.meter} aria-hidden="true">
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span
          key={i}
          className={`${styles.segment} ${i >= SEGMENTS - 2 ? styles.hot : ''} ${i < lit ? styles.lit : ''}`}
        />
      ))}
    </div>
  );
}
