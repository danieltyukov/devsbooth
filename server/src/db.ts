import mongoose from 'mongoose';
import { log } from './log';
import { Follow } from './models/follow';
import { LoginCode } from './models/login-code';
import { Room } from './models/room';
import { Session } from './models/session';
import { User } from './models/user';

mongoose.set('strictQuery', true);

/** Connects, retrying while the database starts up (compose, or the dev database downloading MongoDB). */
export async function connectDb(uri: string, attempts = 1): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
      break;
    } catch (err) {
      if (attempt >= attempts) throw err;
      log.warn('Waiting for MongoDB', { attempt, of: attempts });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  // Build indexes before serving so unique constraints hold from the first request.
  await Promise.all([User.init(), LoginCode.init(), Session.init(), Follow.init(), Room.init()]);
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export function dbIsUp(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}
