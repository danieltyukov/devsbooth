import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useMe } from '../api/queries';
import { FullPageMessage } from '../components/FullPageMessage';
import { errorMessage } from '../api/client';

function Pending({ error }: { error: unknown }): ReactNode {
  if (error) return <FullPageMessage title="Could not load DevsBooth">{errorMessage(error)}</FullPageMessage>;
  return <FullPageMessage title="Loading" quiet />;
}

/** Signed-in users who have finished onboarding. */
export function RequireOnboarded() {
  const me = useMe();
  const location = useLocation();
  if (me.data === undefined) return <Pending error={me.error} />;
  const next = encodeURIComponent(location.pathname + location.search);
  if (me.data === null) return <Navigate to={`/signin?next=${next}`} replace />;
  if (!me.data.onboarded) return <Navigate to={`/welcome?next=${next}`} replace />;
  return <Outlet />;
}

/** Signed-in users, onboarded or not. */
export function RequireSession() {
  const me = useMe();
  const location = useLocation();
  if (me.data === undefined) return <Pending error={me.error} />;
  if (me.data === null) {
    return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <Outlet />;
}

/** Signed-out visitors only; everyone else goes to the rooms. */
export function GuestOnly() {
  const me = useMe();
  if (me.data === undefined) return <Pending error={me.error} />;
  if (me.data) return <Navigate to={me.data.onboarded ? '/rooms' : '/welcome'} replace />;
  return <Outlet />;
}

/** Returns a same-site path from `?next=`, ignoring anything that would leave the app. */
export function safeNext(value: string | null, fallback = '/rooms'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
