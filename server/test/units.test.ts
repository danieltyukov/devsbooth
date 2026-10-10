import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';
import { RoomLifecycle } from '../src/realtime/lifecycle';
import { newRoomId } from '../src/rooms/service';

describe('RoomLifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires vacant rooms and cancels when someone arrives', () => {
    vi.useFakeTimers();
    const expired: string[] = [];
    const lifecycle = new RoomLifecycle(1_000, (id) => expired.push(id));
    lifecycle.vacant('a');
    lifecycle.vacant('b');
    lifecycle.occupied('b');
    vi.advanceTimersByTime(999);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(expired).toEqual(['a']);
    expect(lifecycle.isScheduled('b')).toBe(false);
  });

  it('ensure keeps a running timer instead of restarting it', () => {
    vi.useFakeTimers();
    const expired: string[] = [];
    const lifecycle = new RoomLifecycle(1_000, (id) => expired.push(id));
    lifecycle.vacant('a');
    vi.advanceTimersByTime(600);
    lifecycle.ensure('a');
    vi.advanceTimersByTime(400);
    expect(expired).toEqual(['a']);
  });

  it('does nothing with a zero timeout', () => {
    const lifecycle = new RoomLifecycle(0, () => {
      throw new Error('should not expire');
    });
    lifecycle.vacant('a');
    expect(lifecycle.isScheduled('a')).toBe(false);
  });
});

describe('newRoomId', () => {
  it('makes 10 character base62 ids without repeats', () => {
    const ids = new Set(Array.from({ length: 2_000 }, newRoomId));
    expect(ids.size).toBe(2_000);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{10}$/);
  });
});

describe('loadConfig', () => {
  it('has working defaults', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.appUrl.origin).toBe('http://localhost:3000');
    expect(config.secureCookies).toBe(false);
    expect(config.mail.transport).toBe('log');
    expect(config.room).toEqual({ maxParticipants: 25, emptyTtlMs: 300_000 });
  });

  it('picks SMTP when SMTP_URL is set and secure cookies for https', () => {
    const config = loadConfig({ SMTP_URL: 'smtp://localhost:2525', APP_URL: 'https://booth.example.org' });
    expect(config.mail.transport).toBe('smtp');
    expect(config.secureCookies).toBe(true);
  });

  it('parses ICE servers and rejects bad values', () => {
    const ice = '[{"urls":["turn:turn.example.org:3478"],"username":"u","credential":"p"}]';
    expect(loadConfig({ ICE_SERVERS: ice }).iceServers[0]?.username).toBe('u');
    expect(() => loadConfig({ ICE_SERVERS: 'nope' })).toThrow(ConfigError);
    expect(() => loadConfig({ ICE_SERVERS: '[{"url":"x"}]' })).toThrow(ConfigError);
  });

  it('explains invalid variables', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ MAIL_TRANSPORT: 'smtp' })).toThrow(/SMTP_URL/);
  });
});
