import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { authRouter } from './routes/auth';
import { groupsRouter } from './routes/groups';
import { notificationsRouter } from './routes/notifications';
import { invitationsRouter } from './routes/invitations';
import { errorHandler } from './middleware/error';
import { apiLimiter } from './middleware/rateLimit';
import { notFound } from './lib/errors';
import { prisma } from './lib/prisma';

export function createApp() {
  const app = express();
  app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: false,
  }));
  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'dhukuti-manager', time: new Date().toISOString() }));
  app.get('/api/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, service: 'dhukuti-manager', database: 'ready' });
    } catch {
      res.status(503).json({ ok: false, service: 'dhukuti-manager', database: 'unavailable' });
    }
  });
  app.use('/api', apiLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/invitations', invitationsRouter);
  app.use('/api/groups', groupsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api', (_req, _res, next) => next(notFound('Endpoint')));
  app.use(errorHandler);
  return app;
}
