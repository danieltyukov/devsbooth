import styles from './Avatar.module.css';

interface AvatarProps {
  name: string;
  src: string | null;
  size?: number;
  /** Square corners suit the stage; round suits lists. */
  shape?: 'round' | 'square';
}

/** Muted tones for initials, picked from the name so a person keeps the same color everywhere. */
const TONES = ['#3d5a80', '#5b6c3a', '#7a4b6b', '#2f6f73', '#8a5a2b', '#4b4f8c', '#6b5d4f', '#3f6d4e'];

function tone(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts.at(-1)![0]! : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function Avatar({ name, src, size = 40, shape = 'round' }: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  const className = `${styles.avatar} ${shape === 'square' ? styles.square : ''}`;
  if (src) return <img className={className} src={src} alt="" width={size} height={size} style={style} />;
  return (
    <span className={className} style={{ ...style, background: tone(name) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
