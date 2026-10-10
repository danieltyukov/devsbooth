// Starts the built server against a throwaway MongoDB, with sign-in codes written to
// e2e/.cache/outbox so tests can read them. Used by playwright.config.ts.
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cache = path.resolve(here, '../.cache');
export const PORT = Number(process.env.E2E_PORT ?? 4173);

for (const required of ['server/dist/index.js', 'web/dist/index.html']) {
  if (!existsSync(path.join(root, required))) {
    console.error(`Missing ${required}. Run "npm run build" at the repository root first.`);
    process.exit(1);
  }
}

await rm(cache, { recursive: true, force: true });
const mongod = await MongoMemoryServer.create();

Object.assign(process.env, {
  NODE_ENV: 'production',
  PORT: String(PORT),
  HOST: '127.0.0.1',
  APP_URL: `http://localhost:${PORT}`,
  MONGODB_URI: mongod.getUri('devsbooth-e2e'),
  DATA_DIR: path.join(cache, 'data'),
  WEB_DIST: path.join(root, 'web/dist'),
  MAIL_TRANSPORT: 'file',
  MAIL_OUTBOX_DIR: path.join(cache, 'outbox'),
  // Browsers on one machine reach each other over host candidates; no STUN needed.
  ICE_SERVERS: '[]',
  AUTH_RATE_LIMIT: '0',
  API_RATE_LIMIT: '0',
  ROOM_EMPTY_TTL: '0',
  LOG_LEVEL: 'warn',
});
// Run the suite with presence shared through Redis, as several processes would use it.
if (process.env.E2E_REDIS_URL) {
  process.env.REDIS_URL = process.env.E2E_REDIS_URL;
  process.env.REDIS_PREFIX = `e2e-${Date.now()}:`;
}

const stop = async () => {
  await mongod.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

await import(path.join(root, 'server/dist/index.js'));
