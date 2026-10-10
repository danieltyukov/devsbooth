import type { ReactNode } from 'react';
import styles from './FullPageMessage.module.css';

interface Props {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** A loading state: no visible heading, just a quiet pulse. */
  quiet?: boolean;
}

export function FullPageMessage({ title, children, actions, quiet }: Props) {
  if (quiet) {
    return (
      <div className={styles.page} role="status">
        <span className={styles.pulse} aria-hidden="true" />
        <span className="visually-hidden">{title}</span>
      </div>
    );
  }
  return (
    <div className={styles.page}>
      <div className={styles.box}>
        <h1 className={styles.title}>{title}</h1>
        {children && <div className={styles.body}>{children}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}
