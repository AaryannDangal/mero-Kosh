import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/error';
import { validate } from '../middleware/validate';
import { isManager, requireRole } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimit';
import { fileKeyOf, singleUpload } from '../middleware/upload';
import { forbidden, notFound } from '../lib/errors';
import { mimeForKey, storage } from '../lib/storage';
import * as ledger from '../services/ledger';
import { flushSoon } from '../services/notifications';
import { actorOf } from './util';
import { serializeEntry } from './serializers';
import { correctionSchema, createEntrySchema, disputeSchema, listEntriesQuery, proofSchema, reasonSchema, resolveDisputeSchema, verifyEntrySchema } from './schemas';

export const ledgerRouter = Router({ mergeParams: true });
const MANAGER = requireRole('ORGANIZER', 'CO_ORGANIZER');

ledgerRouter.get('/transactions', validate(listEntriesQuery, 'query'), asyncHandler(async (req, res) => {
  const q = req.query as unknown as ReturnType<typeof listEntriesQuery.parse>;
  const where: Prisma.LedgerEntryWhereInput = {
    groupId: req.group!.id,
    ...(q.memberId ? { memberId: q.memberId } : {}),
    ...(q.roundId ? { roundId: q.roundId } : {}),
    ...(q.type ? { type: q.type } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.from || q.to ? { paidAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: new Date(q.to.getTime() + 86399999) } : {}) } } : {}),
  };
  const [total, entries] = await Promise.all([
    prisma.ledgerEntry.count({ where }),
    prisma.ledgerEntry.findMany({ where, include: { member: { select: { fullName: true } } }, orderBy: { seq: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  const manager = isManager(req) || req.membership!.role === 'VIEWER';
  res.json({ total, page: q.page, pageSize: q.pageSize, entries: entries.map((e) => serializeEntry(e, { manager, ownMemberId: req.membership!.id })) });
}));

ledgerRouter.post('/transactions', uploadLimiter, singleUpload('receipt', 'receipts'), validate(createEntrySchema), asyncHandler(async (req, res) => {
  const entry = await ledger.createEntry(req.group!.id, req.membership!, { ...req.body, receiptPath: fileKeyOf(req) }, actorOf(req));
  flushSoon();
  res.status(201).json({ entry: serializeEntry(entry, { manager: true }) });
}));

ledgerRouter.get('/transactions/:entryId', asyncHandler(async (req, res) => {
  const e = await prisma.ledgerEntry.findFirst({
    where: { id: req.params.entryId, groupId: req.group!.id },
    include: { member: { select: { fullName: true } }, corrections: true, disputes: true },
  });
  if (!e) throw notFound('Transaction');
  const manager = isManager(req) || req.membership!.role === 'VIEWER';
  const own = e.memberId === req.membership!.id;
  res.json({
    entry: serializeEntry(e, { manager, ownMemberId: req.membership!.id }),
    corrections: e.corrections.map((c) => serializeEntry(c, { manager, ownMemberId: req.membership!.id })),
    disputes: manager || own ? e.disputes : [],
  });
}));

ledgerRouter.get('/transactions/:entryId/receipt', asyncHandler(async (req, res) => {
  const e = await prisma.ledgerEntry.findFirst({ where: { id: req.params.entryId, groupId: req.group!.id } });
  if (!e) throw notFound('Transaction');
  if (!isManager(req) && e.memberId !== req.membership!.id) throw forbidden('Receipts are private to the member and organizers');
  if (!e.receiptPath || !(await storage.exists(e.receiptPath))) throw notFound('Receipt');
  res.setHeader('Content-Type', mimeForKey(e.receiptPath));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `inline; filename="receipt-${e.seq}${e.receiptPath.slice(e.receiptPath.lastIndexOf('.'))}"`);
  storage.open(e.receiptPath).pipe(res);
}));

ledgerRouter.post('/transactions/:entryId/proof', uploadLimiter, singleUpload('receipt', 'receipts'), validate(proofSchema), asyncHandler(async (req, res) => {
  const entry = await ledger.attachProof(req.group!.id, req.params.entryId, req.membership!, { receiptPath: fileKeyOf(req), proofUrl: req.body.proofUrl }, actorOf(req));
  res.json({ entry: serializeEntry(entry, { manager: true }) });
}));

ledgerRouter.post('/transactions/:entryId/verify', MANAGER, validate(verifyEntrySchema), asyncHandler(async (req, res) => {
  const entry = await ledger.verifyEntry(req.group!.id, req.params.entryId, req.body.cashReceivedInPerson, actorOf(req));
  flushSoon();
  res.json({ entry: serializeEntry(entry, { manager: true }) });
}));

ledgerRouter.post('/transactions/:entryId/reject', MANAGER, validate(reasonSchema), asyncHandler(async (req, res) => {
  const entry = await ledger.rejectEntry(req.group!.id, req.params.entryId, req.body.reason, actorOf(req));
  flushSoon();
  res.json({ entry: serializeEntry(entry, { manager: true }) });
}));

ledgerRouter.post('/transactions/:entryId/corrections', MANAGER, validate(correctionSchema), asyncHandler(async (req, res) => {
  const entry = await ledger.correctEntry(req.group!.id, req.params.entryId, req.body.amount, req.body.reason, actorOf(req));
  flushSoon();
  res.status(201).json({ entry: serializeEntry(entry, { manager: true }) });
}));

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------
ledgerRouter.post('/transactions/:entryId/disputes', validate(disputeSchema), asyncHandler(async (req, res) => {
  const dispute = await ledger.openDispute(req.group!.id, req.params.entryId, req.membership!, req.body.reason, actorOf(req));
  flushSoon();
  res.status(201).json({ dispute });
}));

ledgerRouter.get('/disputes', asyncHandler(async (req, res) => {
  const manager = isManager(req) || req.membership!.role === 'VIEWER';
  const disputes = await prisma.dispute.findMany({
    where: { groupId: req.group!.id, ...(manager ? {} : { OR: [{ raisedByUserId: req.user!.id }, { entry: { memberId: req.membership!.id } }] }) },
    include: { entry: { include: { member: { select: { fullName: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    disputes: disputes.map((d) => ({ ...d, entry: serializeEntry(d.entry, { manager, ownMemberId: req.membership!.id }) })),
  });
}));

ledgerRouter.post('/disputes/:disputeId/resolve', MANAGER, validate(resolveDisputeSchema), asyncHandler(async (req, res) => {
  const dispute = await ledger.resolveDispute(req.group!.id, req.params.disputeId, req.body, actorOf(req));
  flushSoon();
  res.json({ dispute });
}));
