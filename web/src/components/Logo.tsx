import styles from './Logo.module.css';

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg className={styles.mark} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M6 29V13a10 10 0 0 1 20 0v16"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <rect className={styles.capsule} x="12.4" y="9.5" width="7.2" height="13" rx="3.6" />
      <path d="M10 29h12" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className={styles.logo}>
      <LogoMark />
      <span className={styles.word}>DevsBooth</span>
    </span>
  );
}
