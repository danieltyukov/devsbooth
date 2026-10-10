import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp({ API_RATE_LIMIT: '3' });
});
afterAll(async () => {
  await t.close();
});

describe('rate limits', () => {
  it('limits API requests per IP', async () => {
    for (let i = 0; i < 3; i++) await t.http.get('/api/health').expect(200);
    const res = await t.http.get('/api/health').expect(429);
    expect(res.body.error.code).toBe('too_many_requests');
    expect(res.headers['ratelimit-policy']).toBeTruthy();
  });
});
