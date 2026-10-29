import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/error';
import { requireAuth } from '../middleware/auth';
import { notFound } from '../lib/errors';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const items = await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  const unread = await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } });
  res.json({ unread, notifications: items.map(({ emailTo: _e, dedupeKey: _d, ...n }) => n) });
}));

notificationsRouter.post('/read-all', asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.status(204).end();
}));

notificationsRouter.post('/:id/read', asyncHandler(async (req, res) => {
  const n = await prisma.notification.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!n) throw notFound('Notification');
  await prisma.notification.update({ where: { id: n.id }, data: { readAt: n.readAt ?? new Date() } });
  res.status(204).end();
}));
