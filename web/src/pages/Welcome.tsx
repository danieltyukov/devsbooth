import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useMe } from '../api/queries';
import { safeNext } from '../app/guards';
import { ProfileForm } from '../components/ProfileForm';
import styles from './Form.module.css';

export function Welcome() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  if (!me) return null;
  if (me.onboarded) return <Navigate to={next} replace />;

  return (
    <div className={`container ${styles.page}`}>
      <h1 className={styles.title}>Set up your profile</h1>
      <p className={styles.lede}>This is how people see you in rooms.</p>
      <ProfileForm me={me} submitLabel="Continue" onSaved={() => navigate(next, { replace: true })} />
    </div>
  );
}
