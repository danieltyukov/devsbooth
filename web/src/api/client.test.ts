import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './client';

function respond(status: number, body?: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api', () => {
  it('sends JSON and returns the parsed body', async () => {
    const fetch = respond(200, { ok: 1 });
    vi.stubGlobal('fetch', fetch);
    await expect(api('/rooms', { json: { topic: 'x' } })).resolves.toEqual({ ok: 1 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/rooms');
    expect(init).toMatchObject({ method: 'POST', body: '{"topic":"x"}', credentials: 'same-origin' });
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', respond(204));
    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('turns error bodies into ApiError with field messages', async () => {
    vi.stubGlobal(
      'fetch',
      respond(409, { error: { code: 'conflict', message: 'Taken.', fields: { username: 'Taken.' } } }),
    );
    const error = await api('/me', { method: 'PATCH', json: {} }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'conflict',
      message: 'Taken.',
      fields: { username: 'Taken.' },
    });
  });

  it('explains network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api('/me')).rejects.toMatchObject({ status: 0, message: /reach the server/ });
  });
});
