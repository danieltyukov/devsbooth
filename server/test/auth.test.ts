import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS } from '../src/auth/codes';
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
