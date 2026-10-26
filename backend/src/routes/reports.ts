import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/error';
import { validate } from '../middleware/validate';
import { isManager, requireRole } from '../middleware/auth';
import { forbidden } from '../lib/errors';
import { now } from '../lib/clock';
import { loadGroupState } from '../services/state';
import * as b from '../reports/builders';
import { sendReport } from '../reports/render';
import { auditQuery, reportFormat } from './schemas';

export const reportsRouter = Router({ mergeParams: true });
const READERS = requireRole('ORGANIZER', 'CO_ORGANIZER', 'VIEWER');
const fmt = (q: unknown) => reportFormat.parse(q).format;

reportsRouter.get('/reports/charts', asyncHandler(async (req, res) => {
  const s = await loadGroupState(prisma, req.group!.id, now());
  const data = b.chartData(s);
  if (!isManager(req) && req.membership!.role !== 'VIEWER') {
    // members see group-level charts, but other members' arrears/net positions are anonymised
    data.arrears = data.arrears.map((a) => (a.memberId === req.membership!.id ? a : { ...a, name: '•••' }));
    data.netPositions = data.netPositions.map((n) => (n.memberId === req.membership!.id ? n : { ...n, name: '•••' }));
  }
  res.json(data);
}));

reportsRouter.get('/reports/rounds/:roundId', asyncHandler(async (req, res) => {
  const s = await loadGroupState(prisma, req.group!.id, now());
  await sendReport(res, b.roundReport(s, req.params.roundId), fmt(req.query));
}));

reportsRouter.get('/reports/cycle', asyncHandler(async (req, res) => {
  const s = await loadGroupState(prisma, req.group!.id, now());
  await sendReport(res, b.cycleReport(s), fmt(req.query));
}));

reportsRouter.get('/reports/members/:memberId', asyncHandler(async (req, res) => {
  if (!isManager(req) && req.membership!.role !== 'VIEWER' && req.params.memberId !== req.membership!.id) throw forbidden('You can only download your own statement');
  const s = await loadGroupState(prisma, req.group!.id, now());
  await sendReport(res, b.memberStatement(s, req.params.memberId), fmt(req.query));
}));

reportsRouter.get('/reports/arrears', READERS, asyncHandler(async (req, res) => {
  const s = await loadGroupState(prisma, req.group!.id, now());
  await sendReport(res, b.arrearsReport(s, isManager(req)), fmt(req.query));
}));

reportsRouter.get('/reports/late-payments', READERS, asyncHandler(async (req, res) => {
  const s = await loadGroupState(prisma, req.group!.id, now());
  await sendReport(res, b.latePaymentReport(s), fmt(req.query));
}));

reportsRouter.get('/reports/reconciliation', READERS, asyncHandler(async (req, res) => {
  const s = await loadGroupState(prisma, req.group!.id, now());
  await sendReport(res, b.reconciliationReport(s), fmt(req.query));
}));

reportsRouter.get('/audit', READERS, validate(auditQuery, 'query'), asyncHandler(async (req, res) => {
  const q = req.query as unknown as ReturnType<typeof auditQuery.parse>;
  const where = {
    groupId: req.group!.id,
    ...(q.action ? { action: q.action } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.userId ? { userId: q.userId } : {}),
  };
  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  const userIds = [...new Set(logs.map((l) => l.userId).filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } });
  // sealed bid amounts are hidden from the audit view while bidding is still open
  const openRounds = await prisma.round.findMany({ where: { groupId: req.group!.id, biddingStatus: 'OPEN' }, select: { id: true } });
  const openBidRoundIds = new Set(openRounds.map((r) => r.id));
  const openBids = await prisma.bid.findMany({ where: { roundId: { in: [...openBidRoundIds] } }, select: { id: true } });
  const sealedBidIds = new Set(openBids.map((x) => x.id));
  res.json({
    total,
    logs: logs.map((l) => {
      const sealed = l.entityType === 'Bid' && l.entityId && sealedBidIds.has(l.entityId);
      return { ...l, userName: users.find((u) => u.id === l.userId)?.fullName ?? null, ...(sealed ? { oldValue: '[sealed]', newValue: '[sealed until bidding closes]' } : {}) };
    }),
  });
}));
