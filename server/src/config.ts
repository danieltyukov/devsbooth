import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { IceServer } from '@devsbooth/shared';

const DEFAULT_ICE_SERVERS: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

const iceServerSchema = z.object({
  urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  APP_URL: z.url().optional(),
  MONGODB_URI: z.string().min(1).optional(),
  DATA_DIR: z.string().min(1).default('data'),
  WEB_DIST: z.string().min(1).optional(),
  MAIL_TRANSPORT: z.enum(['smtp', 'log', 'file']).optional(),
  SMTP_URL: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).default('DevsBooth <no-reply@devsbooth.local>'),
  MAIL_OUTBOX_DIR: z.string().min(1).optional(),
  ICE_SERVERS: z.string().optional(),
  ROOM_MAX_PARTICIPANTS: z.coerce.number().int().min(2).max(100).default(25),
  ROOM_EMPTY_TTL: z.coerce.number().int().min(0).default(300),
  AUTH_RATE_LIMIT: z.coerce.number().int().min(0).default(30),
  TRUST_PROXY: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

export type LogLevel = z.infer<typeof envSchema>['LOG_LEVEL'];

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  appUrl: URL;
  /** True when the app is served over https, which turns on Secure cookies. */
  secureCookies: boolean;
  mongoUri: string | undefined;
  dataDir: string;
  avatarsDir: string;
  /** Built web client to serve, or null to run as an API only. */
  webDist: string | null;
  mail: {
    transport: 'smtp' | 'log' | 'file';
    smtpUrl: string | undefined;
    from: string;
    outboxDir: string;
  };
  iceServers: IceServer[];
  room: {
    maxParticipants: number;
    /** How long an empty room stays open, in milliseconds. 0 keeps rooms open until the owner ends them. */
    emptyTtlMs: number;
  };
  /** Sign-in requests allowed per IP per 15 minutes. 0 disables the limit. */
  authRateLimit: number;
  trustProxy: boolean | number | string;
  logLevel: LogLevel;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (value === undefined || value === '' || value === 'false' || value === '0') return false;
  if (value === 'true') return true;
  const hops = Number(value);
  return Number.isInteger(hops) ? hops : value;
}

/** Finds the built web client next to the server when WEB_DIST is not set. */
function findWebDist(): string | null {
  for (const candidate of ['web/dist', '../web/dist']) {
    const dir = path.resolve(candidate);
    if (existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

function parseIceServers(value: string | undefined): IceServer[] {
  if (value === undefined || value.trim() === '') return DEFAULT_ICE_SERVERS;
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    throw new ConfigError('ICE_SERVERS must be a JSON array, for example [{"urls":"stun:stun.example.org"}]');
  }
  const result = z.array(iceServerSchema).safeParse(json);
  if (!result.success) {
    throw new ConfigError('ICE_SERVERS must be an array of {"urls", "username"?, "credential"?} objects');
  }
  return result.data;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Invalid environment:\n${lines.join('\n')}`);
  }
  const e = result.data;

  const appUrl = new URL(e.APP_URL ?? `http://localhost:${e.PORT}`);
  const dataDir = path.resolve(e.DATA_DIR);
  const transport = e.MAIL_TRANSPORT ?? (e.SMTP_URL ? 'smtp' : 'log');
  if (transport === 'smtp' && !e.SMTP_URL) {
    throw new ConfigError('MAIL_TRANSPORT=smtp needs SMTP_URL, for example smtps://user:pass@smtp.example.com:465');
  }

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    appUrl,
    secureCookies: appUrl.protocol === 'https:',
    mongoUri: e.MONGODB_URI,
    dataDir,
    avatarsDir: path.join(dataDir, 'avatars'),
    webDist: e.WEB_DIST ? path.resolve(e.WEB_DIST) : findWebDist(),
    mail: {
      transport,
      smtpUrl: e.SMTP_URL,
      from: e.MAIL_FROM,
      outboxDir: path.resolve(e.MAIL_OUTBOX_DIR ?? path.join(dataDir, 'outbox')),
    },
    iceServers: parseIceServers(e.ICE_SERVERS),
    room: {
      maxParticipants: e.ROOM_MAX_PARTICIPANTS,
      emptyTtlMs: e.ROOM_EMPTY_TTL * 1000,
    },
    authRateLimit: e.AUTH_RATE_LIMIT,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    logLevel: e.LOG_LEVEL,
  };
}
