import { Router } from 'express';
import type { ClientConfig } from '@devsbooth/shared';
import { requireUser } from '../auth/middleware';
import type { Config } from '../config';
import { dbIsUp } from '../db';

export function metaRoutes(config: Config) {
  const router = Router();

  router.get('/health', (_req, res) => {
    const db = dbIsUp();
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db: db ? 'up' : 'down' });
  });

  router.get('/config', requireUser, (_req, res) => {
    const body: ClientConfig = {
      iceServers: config.iceServers,
      maxParticipants: config.room.maxParticipants,
    };
    res.json(body);
  });

  return router;
}
