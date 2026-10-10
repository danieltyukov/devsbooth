import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consumeCode, issueCode, MAX_ATTEMPTS, MAX_FAILURES, RESEND_COOLDOWN_MS } from '../src/auth/codes';
import { HttpError } from '../src/http/errors';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('sign-in codes', () => {
  it('sends a six digit code and signs a new user in', async () => {
    await t.http.post('/api/auth/code').send({ email: 'Ada@Example.com ' }).expect(204);
    const code = t.lastCode('ada@example.com');
    expect(code).toMatch(/^\d{6}$/);

    const res = await t.http
      .post('/api/auth/verify')
      .send({ email: 'ada@example.com', code })
      .expect(200);
    expect(res.body.user).toMatchObject({ email: 'ada@example.com', username: null, onboarded: false });

    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/^devsbooth_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await t.http.get('/api/me').set('Cookie', cookie.split(';')[0]!).expect(200);
    expect(me.body.user.email).toBe('ada@example.com');
  });

  it('returns the same account on the next sign-in', async () => {
    const first = await t.signIn('grace@example.com');
    const second = await t.signIn('grace@example.com');
    const a = await t.http.get('/api/me').set('Cookie', first).expect(200);
    const b = await t.http.get('/api/me').set('Cookie', second).expect(200);
    expect(a.body.user.id).toBe(b.body.user.id);
  });

  it('rejects an invalid email with a field message', async () => {
    const res = await t.http.post('/api/auth/code').send({ email: 'not-an-email' }).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.fields.email).toBeTruthy();
  });

  it('refuses a second code within the cooldown', async () => {
    await t.http.post('/api/auth/code').send({ email: 'linus@example.com' }).expect(204);
    const res = await t.http.post('/api/auth/code').send({ email: 'linus@example.com' }).expect(429);
    expect(res.body.error.code).toBe('too_many_requests');
  });

  it('rejects a wrong code and burns the code after too many attempts', async () => {
    await t.http.post('/api/auth/code').send({ email: 'margaret@example.com' }).expect(204);
    const right = t.lastCode('margaret@example.com');
    const wrong = right === '000000' ? '111111' : '000000';

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await t.http
        .post('/api/auth/verify')
        .send({ email: 'margaret@example.com', code: wrong })
        .expect(400);
      expect(res.body.error.code).toBe('code_invalid');
    }
    const res = await t.http
      .post('/api/auth/verify')
      .send({ email: 'margaret@example.com', code: right })
      .expect(400);
    expect(res.body.error.code).toBe('code_expired');
  });

  it('caps parallel guesses at the per-code limit', async () => {
    await t.http.post('/api/auth/code').send({ email: 'race@example.com' }).expect(204);
    const right = t.lastCode('race@example.com');
    const wrong = right === '000000' ? '111111' : '000000';
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        t.http.post('/api/auth/verify').send({ email: 'race@example.com', code: wrong }),
      ),
    );
    const invalid = results.filter((res) => res.body.error?.code === 'code_invalid');
    expect(invalid).toHaveLength(MAX_ATTEMPTS);
    await t.http.post('/api/auth/verify').send({ email: 'race@example.com', code: right }).expect(400);
  });

  it('keeps counting failures across re-sent codes', async () => {
    const email = 'persistent@example.com';
    const errorCode = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return 'ok';
      } catch (err) {
        return err instanceof HttpError ? err.code : 'other';
      }
    };
    let now = Date.now();
    let failures = 0;
    while (failures < MAX_FAILURES) {
      const code = await issueCode(email, new Date(now));
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < MAX_ATTEMPTS && failures < MAX_FAILURES; i++, failures++) {
        expect(await errorCode(consumeCode(email, wrong, new Date(now)))).toBe('code_invalid');
      }
      now += RESEND_COOLDOWN_MS + 1;
    }
    expect(await errorCode(issueCode(email, new Date(now)))).toBe('too_many_requests');
  });

  it('accepts a code only once', async () => {
    await t.http.post('/api/auth/code').send({ email: 'ken@example.com' }).expect(204);
    const code = t.lastCode('ken@example.com');
    await t.http.post('/api/auth/verify').send({ email: 'ken@example.com', code }).expect(200);
    const res = await t.http.post('/api/auth/verify').send({ email: 'ken@example.com', code }).expect(400);
    expect(res.body.error.code).toBe('code_expired');
  });

  it('logs out by deleting the session', async () => {
    const cookie = await t.signIn('barbara@example.com');
    await t.http.post('/api/auth/logout').set('Cookie', cookie).expect(204);
    const res = await t.http.get('/api/me').set('Cookie', cookie).expect(401);
    expect(res.body.error.code).toBe('unauthorized');
  });
});

describe('request guard', () => {
  it('rejects state-changing requests from another origin', async () => {
    const res = await t.http
      .post('/api/auth/code')
      .set('Origin', 'https://evil.example')
      .send({ email: 'x@example.com' })
      .expect(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('accepts requests from the app origin', async () => {
    await t.http.post('/api/auth/code').set('Origin', t.origin).send({ email: 'y@example.com' }).expect(204);
  });

  it('rejects form-encoded bodies', async () => {
    await t.http.post('/api/auth/code').type('form').send('email=z@example.com').expect(415);
  });

  it('returns JSON 404 for unknown API paths', async () => {
    const res = await t.http.get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('reports health', async () => {
    const res = await t.http.get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('serves client config only to signed-in users', async () => {
    await t.http.get('/api/config').expect(401);
    const cookie = await t.signIn('cfg@example.com');
    const res = await t.http.get('/api/config').set('Cookie', cookie).expect(200);
    expect(res.body.maxParticipants).toBe(25);
    expect(res.body.iceServers).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });
});
