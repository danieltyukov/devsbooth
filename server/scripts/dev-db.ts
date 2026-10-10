// Runs a local MongoDB for development, kept in .data/mongo at the repository root,
// so contributors do not need to install or run MongoDB themselves.
// Skipped when MONGODB_URI is set: then the server uses that database instead.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { DEV_DB_PORT } from './dev-db-uri';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

if (process.env.MONGODB_URI) {
  console.log('MONGODB_URI is set, not starting a local database.');
  // Stay alive so `concurrently -k` keeps the other processes running.
  setInterval(() => {}, 1 << 30);
} else {
  const dbPath = path.join(root, '.data', 'mongo');
  await mkdir(dbPath, { recursive: true });
  const mongod = await MongoMemoryServer.create({
    instance: { port: DEV_DB_PORT, dbPath, storageEngine: 'wiredTiger' },
  });
  console.log(`Local MongoDB on ${mongod.getUri()} (data in .data/mongo)`);

  const stop = async () => {
    await mongod.stop({ doCleanup: false });
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
