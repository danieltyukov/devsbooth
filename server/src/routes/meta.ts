import { Router } from 'express';
import type { ClientConfig } from '@devsbooth/shared';
import { requireUser } from '../auth/middleware';
import type { Config } from '../config';
import type { SfuGateway } from '../media/sfu';
import { dbIsUp } from '../db';

export function metaRoutes(config: Config, sfu: SfuGateway | null) {
  const router = Router();

  router.get('/health', (_req, res) => {
    const db = dbIsUp();
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db: db ? 'up' : 'down' });
  });

  router.get('/config', requireUser, (_req, res) => {
    const body: ClientConfig = {
      media: sfu ? 'sfu' : 'mesh',
      sfuUrl: sfu?.url ?? null,
      iceServers: config.iceServers,
      iceTransportPolicy: config.iceTransportPolicy,
      maxParticipants: config.room.maxParticipants,
    };
    res.json(body);
  });

  return router;
}
