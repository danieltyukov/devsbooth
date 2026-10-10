// Development entry: the defaults that make `npm run dev` work with no setup.
// The web client runs on Vite (5173) and proxies /api and /socket.io here.
import { DEV_DB_URI } from '../scripts/dev-db-uri';

process.env.APP_URL ??= 'http://localhost:5173';
process.env.MONGODB_URI ??= DEV_DB_URI;

await import('./index');
