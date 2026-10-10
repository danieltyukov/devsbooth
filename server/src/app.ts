import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { createMailer, type Mailer } from './auth/mailer';
import { loadSession } from './auth/middleware';
import type { Config } from './config';
import { apiNotFound, errorHandler, HttpError } from './http/errors';
import { sameOriginGuard } from './http/guard';
import { createHub, type Hub, type IoServer } from './realtime/hub';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { metaRoutes } from './routes/meta';
import { roomRoutes } from './routes/rooms';
import { userRoutes } from './routes/users';
import { AVATAR_ROUTE } from './users/dto';

export interface AppInstance {
  app: Express;
  server: HttpServer;
  io: IoServer;
  hub: Hub;
  close(): Promise<void>;
}

export interface AppOptions {
  /** Replaces the configured mail transport, for tests. */
  mailer?: Mailer;
}

function contentSecurityPolicy(appUrl: URL) {
  const socketOrigin = `${appUrl.protocol === 'https:' ? 'wss' : 'ws'}://${appUrl.host}`;
  return {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'", socketOrigin],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      ...(appUrl.protocol === 'https:' ? { upgradeInsecureRequests: [] } : {}),
    },
  };
}

export function createApp(config: Config, options: AppOptions = {}): AppInstance {
  const app = express();
  const server = createServer(app);
  const io: IoServer = new Server(server, {
    serveClient: false,
    maxHttpBufferSize: 100_000,
  });
  const hub = createHub(io, config);
  const mailer = options.mailer ?? createMailer(config);

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: contentSecurityPolicy(config.appUrl),
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: config.secureCookies,
    }),
  );

  /** A per-IP limiter. A limit of 0 turns it off (tests, or a trusted private network). */
  const perIp = (windowMs: number, limit: number, message: string) =>
    rateLimit({
      windowMs,
      limit: Math.max(limit, 1),
      skip: () => limit === 0,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new HttpError(429, 'too_many_requests', message)),
    });
  const limiter = perIp(
    15 * 60 * 1000,
    config.authRateLimit,
    'Too many sign-in attempts. Wait a few minutes.',
  );
  const apiLimiter = perIp(60 * 1000, config.apiRateLimit, 'Too many requests. Wait a minute and try again.');

  const api = express.Router();
  api.use(apiLimiter);
  api.use(express.json({ limit: '100kb' }));
  api.use(sameOriginGuard(config.appUrl.origin));
  api.use(loadSession(config.secureCookies));
  api.use(
    '/auth',
    authRoutes({
      mailer,
      secureCookies: config.secureCookies,
      limiter,
      onLogout: (token) => hub.dropSession(token),
    }),
  );
  api.use('/me', meRoutes({ avatarsDir: config.avatarsDir }));
  api.use('/users', userRoutes());
  api.use('/rooms', roomRoutes(hub));
  api.use(metaRoutes(config));
  api.use(apiNotFound);
  app.use('/api', api);

  app.use(
    AVATAR_ROUTE,
    apiLimiter,
    express.static(config.avatarsDir, { immutable: true, maxAge: '30d', fallthrough: false }),
  );

  if (config.webDist && existsSync(path.join(config.webDist, 'index.html'))) {
    const webDist = config.webDist;
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders(res, file) {
          // Vite fingerprints everything under assets/, so those never change.
          if (file.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get('/{*path}', apiLimiter, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  return {
    app,
    server,
    io,
    hub,
    async close() {
      hub.close();
      await io.close();
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  };
}
