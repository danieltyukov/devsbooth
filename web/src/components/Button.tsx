import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface Common {
  variant?: Variant;
  size?: 'm' | 'l';
  icon?: ReactNode;
  children?: ReactNode;
}

function classes(variant: Variant, size: 'm' | 'l', extra?: string) {
  return [styles.button, styles[variant], size === 'l' ? styles.large : '', extra ?? ''].join(' ');
}

export function Button({
  variant = 'primary',
  size = 'm',
  icon,
  children,
  busy,
  className,
  type = 'button',
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      type={type}
      className={classes(variant, size, className)}
      aria-busy={busy || undefined}
      disabled={busy || rest.disabled}
      {...rest}
    >
      {icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function ButtonLink({
  variant = 'primary',
  size = 'm',
  icon,
  children,
  className,
  ...rest
}: Common & LinkProps) {
  return (
    <Link className={classes(variant, size, className)} {...rest}>
      {icon}
      {children && <span>{children}</span>}
    </Link>
  );
}
