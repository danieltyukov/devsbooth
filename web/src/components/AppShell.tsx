import { Link, NavLink, Outlet } from 'react-router';
import { useMe } from '../api/queries';
import { Avatar } from './Avatar';
import { Logo } from './Logo';
import styles from './AppShell.module.css';

export function AppShell() {
  const { data: me } = useMe();
  return (
    <>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={`container ${styles.bar}`}>
          <Link to={me ? '/rooms' : '/'} className={styles.home} aria-label="DevsBooth home">
            <Logo />
          </Link>
          {me?.onboarded && (
            <nav className={styles.nav} aria-label="Main">
              <NavLink
                to="/rooms"
                className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
              >
                Rooms
              </NavLink>
              <NavLink
                to={`/u/${me.username}`}
                className={styles.profile}
                aria-label={`Your profile, ${me.name}`}
                title="Your profile"
              >
                <Avatar name={me.name ?? ''} src={me.avatarUrl} size={34} />
              </NavLink>
            </nav>
          )}
        </div>
      </header>
      <main id="main" className={styles.main}>
        <Outlet />
      </main>
    </>
  );
}
