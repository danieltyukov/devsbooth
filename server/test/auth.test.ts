import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, MAX_CODES_PER_WINDOW } from '../src/auth/codes';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

async function requestCode(email: string): Promise<{ challenge: string; code: string }> {
  const res = await t.http.post('/api/auth/code').send({ email }).expect(200);
  return { challenge: res.body.challenge as string, code: t.lastCode(email.trim().toLowerCase()) };
}

function verify(email: string, code: string, challenge: string) {
  return t.http.post('/api/auth/verify').send({ email, code, challenge });
}

const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

describe('sign-in codes', () => {
  it('sends a six digit code and signs a new user in', async () => {
    const { challenge, code } = await requestCode('Ada@Example.com ');
    expect(code).toMatch(/^\d{6}$/);
    expect(challenge.length).toBeGreaterThanOrEqual(32);

    const res = await verify('ada@example.com', code, challenge).expect(200);
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

  it('needs the challenge from the browser that asked for the code', async () => {
    const victim = await requestCode('victim@example.com');
    const attacker = await requestCode('victim@example.com');
    // The right code with someone else's challenge does not work...
    const res = await verify('victim@example.com', victim.code, attacker.challenge).expect(400);
    expect(res.body.error.code).toBe('code_invalid');
    // ...and the attacker's request did not cancel the victim's code.
    await verify('victim@example.com', victim.code, victim.challenge).expect(200);
  });

  it('burns a code after too many wrong attempts, even in parallel', async () => {
    const { challenge, code } = await requestCode('race@example.com');
    const results = await Promise.all(
      Array.from({ length: 20 }, () => verify('race@example.com', wrongCode(code), challenge)),
    );
    expect(results.filter((res) => res.body.error?.code === 'code_invalid')).toHaveLength(MAX_ATTEMPTS);
    const after = await verify('race@example.com', code, challenge).expect(400);
    expect(after.body.error).toMatchObject({ code: 'code_expired', message: expect.stringMatching(/attempts/) });
  });

  it('caps the codes sent to one address per hour', async () => {
    for (let i = 0; i < MAX_CODES_PER_WINDOW; i++) await requestCode('flood@example.com');
    const res = await t.http.post('/api/auth/code').send({ email: 'flood@example.com' }).expect(429);
    expect(res.body.error.code).toBe('too_many_requests');
    // Other addresses are unaffected.
    await requestCode('calm@example.com');
  });

  it('caps concurrent requests too', async () => {
    const results = await Promise.all(
      Array.from({ length: 15 }, () => t.http.post('/api/auth/code').send({ email: 'burst@example.com' })),
    );
    expect(results.filter((res) => res.status === 200).length).toBeLessThanOrEqual(MAX_CODES_PER_WINDOW);
  });

  it('accepts a code only once and retires the other codes for the address', async () => {
    const first = await requestCode('ken@example.com');
    const second = await requestCode('ken@example.com');
    await verify('ken@example.com', second.code, second.challenge).expect(200);
    const replay = await verify('ken@example.com', second.code, second.challenge).expect(400);
    expect(replay.body.error.code).toBe('code_expired');
    const stale = await verify('ken@example.com', first.code, first.challenge).expect(400);
    expect(stale.body.error.code).toBe('code_expired');
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
    await t.http.post('/api/auth/code').set('Origin', t.origin).send({ email: 'y@example.com' }).expect(200);
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
