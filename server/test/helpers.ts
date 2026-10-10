import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { inject } from 'vitest';
import type { ClientToServerEvents, Me, ServerToClientEvents } from '@devsbooth/shared';
import { createApp, type AppInstance } from '../src/app';
import type { Mailer } from '../src/auth/mailer';
import { loadConfig } from '../src/config';
import { connectDb, disconnectDb } from '../src/db';
import { setLogLevel } from '../src/log';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface TestApp {
  instance: AppInstance;
  origin: string;
  http: ReturnType<typeof request>;
  /** Codes sent so far, newest last. */
  outbox: { email: string; code: string }[];
  lastCode(email: string): string;
  /** Signs in and returns the session cookie. */
  signIn(email: string): Promise<string>;
  /** Signs in and finishes onboarding. */
  createUser(username: string): Promise<{ cookie: string; user: Me }>;
  socket(cookie: string): Promise<ClientSocket>;
  close(): Promise<void>;
}

export async function startTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  setLogLevel('silent');
  const dataDir = await mkdtemp(path.join(tmpdir(), 'devsbooth-test-'));
  const dbName = `test_${randomBytes(6).toString('hex')}`;
  const baseUri = inject('mongoUri');
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3999',
    DATA_DIR: dataDir,
    AUTH_RATE_LIMIT: '0',
    ROOM_EMPTY_TTL: '0',
    LOG_LEVEL: 'silent',
    ...env,
  });
  await connectDb(`${baseUri.replace(/\/?$/, '/')}${dbName}`);

  const outbox: { email: string; code: string }[] = [];
  const mailer: Mailer = {
    async sendCode(email, code) {
      outbox.push({ email, code });
    },
  };
  const instance = createApp(config, { mailer });
  await new Promise<void>((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const { port } = instance.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const http = request(base);
  const sockets: ClientSocket[] = [];

  const lastCode = (email: string) => {
    const entry = outbox.findLast((item) => item.email === email);
    if (!entry) throw new Error(`No code sent to ${email}`);
    return entry.code;
  };

  const signIn = async (email: string) => {
    const sent = await http.post('/api/auth/code').send({ email }).expect(200);
    const res = await http
      .post('/api/auth/verify')
      .send({ email, code: lastCode(email), challenge: sent.body.challenge })
      .expect(200);
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    return setCookie[0]!.split(';')[0]!;
  };

  return {
    instance,
    origin: config.appUrl.origin,
    http,
    outbox,
    lastCode,
    signIn,
    async createUser(username) {
      const cookie = await signIn(`${username}@example.com`);
      const res = await http
        .patch('/api/me')
        .set('Cookie', cookie)
        .send({ name: username.toUpperCase(), username })
        .expect(200);
      return { cookie, user: res.body.user as Me };
    },
    async socket(cookie) {
      const socket: ClientSocket = connect(base, {
        transports: ['websocket'],
        extraHeaders: { cookie },
        forceNew: true,
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      return socket;
    },
    async close() {
      for (const socket of sockets) socket.disconnect();
      await instance.close();
      await mongoose.connection.dropDatabase();
      await disconnectDb();
    },
  };
}

/** Resolves with the next payload of `event`, or rejects after `ms`. */
export function next<E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  ms = 3_000,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${String(event)}`)), ms);
    socket.once(event as never, ((payload: never) => {
      clearTimeout(timer);
      resolve(payload);
    }) as never);
  });
}

export function emitWithAck<E extends 'room:join' | 'role:set'>(
  socket: ClientSocket,
  event: E,
  payload: Parameters<ClientToServerEvents[E]>[0],
): Promise<Parameters<Parameters<ClientToServerEvents[E]>[1]>[0]> {
  return new Promise((resolve) => {
    (socket.emit as (...args: unknown[]) => void)(event, payload, resolve);
  });
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
