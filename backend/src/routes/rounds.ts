import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/error';
import { validate } from '../middleware/validate';
import { isManager, requireRole } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimit';
import { fileKeyOf, singleUpload } from '../middleware/upload';
import { forbidden, notFound } from '../lib/errors';
import { now } from '../lib/clock';
import * as rounds from '../services/rounds';
import { arrearsBefore, loadGroupState } from '../services/state';
import { flushSoon } from '../services/notifications';
import { winnerIneligibilityReason } from '../domain/calculations';
import { actorOf } from './util';
import { bidSchema, closeRoundSchema, overrideSchema, payoutSchema } from './schemas';

export const roundsRouter = Router({ mergeParams: true });
const MANAGER = requireRole('ORGANIZER', 'CO_ORGANIZER');

roundsRouter.get('/', asyncHandler(async (req, res) => {
  const s = await loadGroupState(prisma, req.group!.id, now());
  res.json({
    rounds: s.rounds.map((r) => {
      const paid = r.obligations.reduce((a, o) => a + (s.balances.get(o.memberId)?.rounds.find((x) => x.roundId === r.id)?.paid ?? 0), 0);
      const { obligations: _o, ...rest } = r;
      return {
        ...rest,
        winnerName: s.members.find((m) => m.id === r.winnerMemberId)?.fullName ?? null,
        plannedRecipient: s.group.selectionMethod === 'FIXED_ROTATION' && !r.winnerMemberId ? s.members.find((m) => m.rotationOrder === r.roundNumber && m.status !== 'EXITED')?.fullName ?? null : null,
        collectedForRound: paid,
      };
    }),
  });
}));

roundsRouter.get('/:roundId', asyncHandler(async (req, res) => {
  const manager = isManager(req);
  const s = await loadGroupState(prisma, req.group!.id, now());
  const r = s.rounds.find((x) => x.id === req.params.roundId);
  if (!r) throw notFound('Round');
  const name = (id: string | null) => s.members.find((m) => m.id === id)?.fullName ?? null;
  const checklist = r.obligations.map((o) => {
    const bal = s.balances.get(o.memberId)!;
    const rs = bal.rounds.find((x) => x.roundId === r.id)!;
    return {
      memberId: o.memberId,
      fullName: name(o.memberId),
      ...rs,
      isWinner: o.memberId === r.winnerMemberId,
      hasReceivedPot: bal.hasReceivedPot,
      potObligation: bal.potObligation ?? null,
    };
  });
  const bids = await prisma.bid.findMany({ where: { roundId: r.id }, orderBy: { submittedAt: 'asc' } });
  const potRequests = r.selectionMethod === 'ADMIN_SELECTION'
    ? await prisma.potRequest.findMany({ where: { roundId: r.id }, include: { member: { select: { fullName: true } } }, orderBy: { createdAt: 'asc' } })
    : [];
  const revealed = r.biddingStatus === 'CLOSED';
  const bidView = bids
    .filter((b) => revealed || manager || b.memberId === req.membership!.id)
    .map((b) => ({
      memberId: b.memberId,
      fullName: name(b.memberId),
      isWinning: b.isWinning,
      // sealed: amounts hidden from everyone (organizers included) until bidding closes, except your own bid
      discountAmount: revealed || b.memberId === req.membership!.id ? b.discountAmount : null,
      submittedAt: revealed || b.memberId === req.membership!.id ? b.submittedAt : null,
    }));
  const payout = r.payoutEntryId ? await prisma.ledgerEntry.findUnique({ where: { id: r.payoutEntryId } }) : null;
  const preview = r.status === 'UPCOMING' ? null : await rounds.previewReconciliation(req.group!.id, r.id);
  const eligibleWinners = r.status === 'UPCOMING' ? [] : [...s.balances.values()].filter((b) => !winnerIneligibilityReason(
    { status: b.status, isContributor: b.isContributor, hasReceivedPot: b.hasReceivedPot, arrears: arrearsBefore(b, r.roundNumber), currentRoundUnpaid: 0 },
    false,
  )).map((b) => ({ memberId: b.memberId, fullName: b.fullName }));
  const limits = r.biddingStatus === 'OPEN' ? await rounds.getBidLimits(req.group!.id, r.id) : null;
  const { obligations: _o, ...round } = r;
  res.json({
    round: { ...round, winnerName: name(r.winnerMemberId) },
    checklist: manager || req.membership!.role === 'VIEWER' ? checklist : checklist.map((c) => (c.memberId === req.membership!.id ? c : { ...c, pending: undefined, lateFeeAssessed: undefined, lateFeeOutstanding: undefined, lateFeePaid: undefined })),
    bids: { revealed, count: bids.length, items: bidView, limits, myBid: bids.find((b) => b.memberId === req.membership!.id) ?? null },
    payout: payout && { id: payout.id, seq: payout.seq, amount: payout.amount, status: payout.status, method: payout.method, paidAt: payout.paidAt, referenceNumber: manager ? payout.referenceNumber : undefined, hasReceipt: !!payout.receiptPath },
    reconciliation: preview,
    eligibleWinners,
    potRequests: potRequests.map((p) => ({ memberId: p.memberId, fullName: p.member.fullName, createdAt: p.createdAt, isMe: p.memberId === req.membership!.id })),
    myPotRequest: potRequests.some((p) => p.memberId === req.membership!.id),
    canRequestPot: r.selectionMethod === 'ADMIN_SELECTION' && eligibleWinners.some((member) => member.memberId === req.membership!.id),
  });
}));

roundsRouter.post('/:roundId/requests/me', asyncHandler(async (req, res) => {
  const request = await rounds.requestPot(req.group!.id, req.params.roundId, req.membership!.id, actorOf(req));
  res.status(201).json({ request });
}));

roundsRouter.delete('/:roundId/requests/me', asyncHandler(async (req, res) => {
  await rounds.withdrawPotRequest(req.group!.id, req.params.roundId, req.membership!.id, actorOf(req));
  res.status(204).end();
}));

roundsRouter.post('/:roundId/winner-override', MANAGER, validate(overrideSchema), asyncHandler(async (req, res) => {
  const round = await rounds.overrideWinner(req.group!.id, req.params.roundId, req.body, actorOf(req));
  flushSoon();
  res.json({ round });
}));

roundsRouter.post('/:roundId/payout', MANAGER, uploadLimiter, singleUpload('receipt', 'receipts'), validate(payoutSchema), asyncHandler(async (req, res) => {
  const entry = await rounds.recordPayout(req.group!.id, req.params.roundId, { ...req.body, receiptPath: fileKeyOf(req) }, actorOf(req));
  flushSoon();
  res.status(201).json({ entry });
}));

roundsRouter.post('/:roundId/close', MANAGER, validate(closeRoundSchema), asyncHandler(async (req, res) => {
  const result = await rounds.closeRound(req.group!.id, req.params.roundId, req.body, actorOf(req));
  flushSoon();
  res.json(result);
}));

roundsRouter.get('/:roundId/reconciliation', asyncHandler(async (req, res) => {
  const actual = req.query.actualClosingBalance !== undefined ? Number(req.query.actualClosingBalance) : undefined;
  res.json(await rounds.previewReconciliation(req.group!.id, req.params.roundId, Number.isFinite(actual) ? actual : undefined));
}));

// ---------------------------------------------------------------------------
// Bids
// ---------------------------------------------------------------------------
roundsRouter.put('/:roundId/bids/me', validate(bidSchema), asyncHandler(async (req, res) => {
  if (req.membership!.role === 'VIEWER') throw forbidden('Viewers cannot bid');
  const result = await rounds.submitBid(req.group!.id, req.params.roundId, req.membership!.id, req.body.discountAmount, actorOf(req));
  res.json(result);
}));

roundsRouter.delete('/:roundId/bids/me', asyncHandler(async (req, res) => {
  await rounds.withdrawBid(req.group!.id, req.params.roundId, req.membership!.id, actorOf(req));
  res.status(204).end();
}));

roundsRouter.post('/:roundId/bids/close', MANAGER, asyncHandler(async (req, res) => {
  const round = await rounds.closeBidding(req.group!.id, req.params.roundId, actorOf(req));
  flushSoon();
  res.json({ round });
}));
