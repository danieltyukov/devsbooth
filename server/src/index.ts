import { existsSync } from 'node:fs';
import path from 'node:path';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { connectDb, disconnectDb } from './db';
import { log, setLogLevel } from './log';

function loadDotEnv(): void {
  for (const candidate of ['.env', '../.env']) {
    const file = path.resolve(candidate);
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  setLogLevel(config.logLevel);
  if (!config.mongoUri) {
    throw new ConfigError('MONGODB_URI is not set, for example mongodb://localhost:27017/devsbooth');
  }

  // About a minute of retries covers a database container or the dev database still starting.
  await connectDb(config.mongoUri, 10);
  const instance = createApp(config);
  await instance.hub.scheduleIdleRooms();

  await new Promise<void>((resolve) => instance.server.listen(config.port, config.host, resolve));
  log.info(`DevsBooth is listening on ${config.appUrl.origin}`, {
    port: config.port,
    mail: config.mail.transport,
    web: config.webDist ? 'bundled' : 'api only',
  });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`Received ${signal}, shutting down`);
    await instance.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
