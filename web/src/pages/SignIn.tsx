import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { LIMITS, type CodeChallenge, type Me } from '@devsbooth/shared';
import { api, ApiError, errorMessage } from '../api/client';
import { useSetMe } from '../api/queries';
import { safeNext } from '../app/guards';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Notice } from '../components/Notice';
import styles from './Form.module.css';

type Step = { kind: 'email' } | { kind: 'code'; email: string; challenge: string };

export function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setMe = useSetMe();
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const next = safeNext(params.get('next'));

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { challenge } = await api<CodeChallenge>('/auth/code', { json: { email } });
      setStep({ kind: 'code', email: email.trim().toLowerCase(), challenge });
      setCode('');
    } catch (err) {
      setError({ message: errorMessage(err), field: err instanceof ApiError ? err.fields.email : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (step.kind !== 'code') return;
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: Me }>('/auth/verify', {
        json: { email: step.email, code, challenge: step.challenge },
      });
      setMe(user);
      navigate(user.onboarded ? next : `/welcome?next=${encodeURIComponent(next)}`, { replace: true });
    } catch (err) {
      setError({ message: errorMessage(err), field: err instanceof ApiError ? err.fields.code : undefined });
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === 'email') {
    return (
      <div className={`container ${styles.page}`}>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.lede}>
          Enter your email and we will send you a code. New here? The same code creates your account.
        </p>
        <form className={styles.form} onSubmit={sendCode} noValidate>
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={LIMITS.emailMax}
            required
            autoFocus
            error={error?.field}
          />
          {error && !error.field && <Notice tone="error">{error.message}</Notice>}
          <div>
            <Button type="submit" size="l" busy={busy}>
              Send code
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className={`container ${styles.page}`}>
      <h1 className={styles.title}>Check your email</h1>
      <p className={styles.lede}>
        We sent an {LIMITS.codeLength}-digit code to <strong>{step.email}</strong>. It works for 10 minutes.
      </p>
      {import.meta.env.DEV && (
        <Notice>Running locally without SMTP? The code is printed in the server log.</Notice>
      )}
      <form className={styles.form} onSubmit={verify} noValidate>
        <Field
          label="Code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/[^\d\s]/g, ''))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={LIMITS.codeLength + 1}
          className={styles.code}
          required
          autoFocus
          error={error?.field}
        />
        {error && !error.field && <Notice tone="error">{error.message}</Notice>}
        <div className={styles.row}>
          <Button type="submit" size="l" busy={busy}>
            Sign in
          </Button>
          <Button variant="ghost" onClick={() => void sendCode()} disabled={busy}>
            Send a new code
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setStep({ kind: 'email' });
              setError(null);
            }}
          >
            Use a different email
          </Button>
        </div>
      </form>
    </div>
  );
}
