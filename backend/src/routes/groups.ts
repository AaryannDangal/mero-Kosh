import { Router, type Request } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/error';
import { validate } from '../middleware/validate';
import { isManager, loadGroup, requireAuth, requireRole } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimit';
import { fileKeyOf, singleUpload } from '../middleware/upload';
import { forbidden, notFound, unprocessable } from '../lib/errors';
import { now } from '../lib/clock';
import { mimeForKey, storage } from '../lib/storage';
import * as groups from '../services/groups';
import { startGroup } from '../services/rounds';
import { roundsRouter } from './rounds';
import { ledgerRouter } from './ledger';
import { reportsRouter } from './reports';
import { runReminders } from '../jobs/reminders';
import { loadGroupState } from '../services/state';
import { flushSoon } from '../services/notifications';
import { serializeMember } from './serializers';
import {
  addMemberSchema, createGroupSchema, deleteGroupSchema, exitSchema, memberStatusSchema, reasonSchema,
  updateGroupSchema, updateMemberSchema,
} from './schemas';

export const groupsRouter = Router();
groupsRouter.use(requireAuth);

import { actorOf } from './util';
export { actorOf };
const MANAGER = requireRole('ORGANIZER', 'CO_ORGANIZER');

function serializeGroup(g: NonNullable<Request['group']>, _manager = false) {
  const { inviteCode: _legacyInviteCode, deletedAt: _d, ...rest } = g;
  return rest;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
groupsRouter.get('/', asyncHandler(async (req, res) => {
  const memberships = await prisma.groupMember.findMany({
    where: { userId: req.user!.id, group: { deletedAt: null } },
    include: { group: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    groups: memberships.map((m) => ({
      ...serializeGroup(m.group, m.role === 'ORGANIZER' || m.role === 'CO_ORGANIZER'),
      myRole: m.role,
      myMemberId: m.id,
      myStatus: m.status,
    })),
  });
}));

groupsRouter.post('/', validate(createGroupSchema), asyncHandler(async (req, res) => {
  const { organizerParticipates, ...input } = req.body;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!user.phone) throw unprocessable('Add a phone number to your account before creating a group');
  const group = await groups.createGroup(input, { userId: user.id, fullName: user.fullName, email: user.email, phone: user.phone, participates: organizerParticipates }, actorOf(req));
  res.status(201).json({ group: serializeGroup(group), rules: groups.rulesFor(group) });
}));

const g = Router({ mergeParams: true });
groupsRouter.use('/:groupId', loadGroup, g);

g.get('/', asyncHandler(async (req, res) => {
  const manager = isManager(req);
  res.json({ group: serializeGroup(req.group!, manager), myRole: req.membership!.role, myMemberId: req.membership!.id, rules: groups.rulesFor(req.group!) });
}));

g.patch('/', MANAGER, validate(updateGroupSchema), asyncHandler(async (req, res) => {
  const group = await groups.updateGroup(req.group!, req.body, actorOf(req));
  res.json({ group: serializeGroup(group), rules: groups.rulesFor(group) });
}));

g.delete('/', requireRole('ORGANIZER'), validate(deleteGroupSchema), asyncHandler(async (req, res) => {
  await groups.softDeleteGroup(req.group!, req.body.reason, actorOf(req));
  res.status(204).end();
}));

g.get('/rules', asyncHandler(async (req, res) => {
  res.json({ rules: groups.rulesFor(req.group!), confirmedAt: req.group!.rulesConfirmedAt });
}));

g.post('/confirm-rules', MANAGER, asyncHandler(async (req, res) => {
  const group = await groups.confirmRules(req.group!, actorOf(req));
  res.json({ group: serializeGroup(group), rules: groups.rulesFor(group) });
}));

g.post('/start', MANAGER, asyncHandler(async (req, res) => {
  const group = await startGroup(req.group!.id, actorOf(req));
  flushSoon();
  res.json({ group: serializeGroup(group) });
}));

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------
g.get('/dashboard', asyncHandler(async (req, res) => {
  const manager = isManager(req) || req.membership!.role === 'VIEWER';
  const s = await loadGroupState(prisma, req.group!.id, now());
  const cr = s.currentRound;
  let current = null;
  if (cr) {
    const states = cr.obligations.map((o) => ({ o, rs: s.balances.get(o.memberId)!.rounds.find((r) => r.roundId === cr.id)! }));
    current = {
      id: cr.id, roundNumber: cr.roundNumber, periodLabel: cr.periodLabel, dueDate: cr.dueDate, status: cr.status, biddingStatus: cr.biddingStatus,
      fullPot: cr.fullPot, bidDiscount: cr.bidDiscount, payoutToWinner: cr.payoutToWinner, winnerMemberId: cr.winnerMemberId,
      winnerName: s.members.find((m) => m.id === cr.winnerMemberId)?.fullName ?? null,
      expected: cr.expectedCollection ?? 0,
      collected: states.reduce((a, x) => a + x.rs.paid, 0),
      pending: states.reduce((a, x) => a + x.rs.pending, 0),
      outstanding: states.reduce((a, x) => a + x.rs.outstanding, 0),
      paidCount: states.filter((x) => x.rs.status === 'PAID').length,
      contributorCount: states.length,
      payoutRecorded: !!cr.payoutEntryId,
    };
  }
  const overdueMembers = [...s.balances.values()]
    .filter((b) => b.overdueAmount > 0 || b.lateFeeOutstanding > 0)
    .map((b) => {
      const m = s.members.find((x) => x.id === b.memberId)!;
      return { memberId: b.memberId, fullName: b.fullName, overdueAmount: b.overdueAmount, arrears: b.arrears, lateFeeOutstanding: b.lateFeeOutstanding, ...(manager ? { phone: m.phone } : {}) };
    });
  const nextRound = cr ?? s.rounds.find((r) => r.status === 'UPCOMING') ?? null;
  const [pendingVerifications, openDisputes] = await Promise.all([
    prisma.ledgerEntry.count({ where: { groupId: req.group!.id, status: 'PENDING' } }),
    prisma.dispute.count({ where: { groupId: req.group!.id, status: 'OPEN' } }),
  ]);
  res.json({
    group: serializeGroup(req.group!, isManager(req)),
    currentRound: current,
    totals: {
      expected: current?.expected ?? 0,
      collected: current?.collected ?? 0,
      outstanding: current?.outstanding ?? 0,
      totalArrears: [...s.balances.values()].reduce((a, b) => a + b.arrears, 0),
      fundBalance: s.fundBalance,
    },
    overdueMembers,
    nextPayout: nextRound
      ? {
        roundNumber: nextRound.roundNumber,
        dueDate: nextRound.dueDate,
        recipient: s.members.find((m) => m.id === nextRound.winnerMemberId)?.fullName
          ?? (s.group.selectionMethod === 'FIXED_ROTATION' ? s.members.find((m) => m.rotationOrder === nextRound.roundNumber)?.fullName ?? null : null),
        amount: nextRound.payoutToWinner ?? nextRound.fullPot ?? s.group.contributionAmount * s.group.memberCount,
      }
      : null,
    roundsCompleted: s.rounds.filter((r) => r.status === 'COMPLETED').length,
    roundsTotal: s.rounds.length,
    cycleValidation: s.cycleValidation,
    pendingVerifications,
    openDisputes,
  });
}));

/** The caller's own member dashboard. */
g.get('/me', asyncHandler(async (req, res) => {
  const s = await loadGroupState(prisma, req.group!.id, now());
  const b = s.balances.get(req.membership!.id);
  const history = await prisma.ledgerEntry.findMany({ where: { groupId: req.group!.id, memberId: req.membership!.id }, orderBy: { paidAt: 'desc' } });
  res.json({ member: serializeMember(req.membership!, { manager: false, self: true }), balance: b, history, currentRoundId: s.currentRound?.id ?? null });
}));

g.get('/validation', asyncHandler(async (req, res) => {
  const s = await loadGroupState(prisma, req.group!.id, now());
  res.json({
    status: s.group.status,
    allRoundsClosed: s.rounds.length > 0 && s.rounds.every((r) => r.status === 'COMPLETED'),
    fundBalance: s.fundBalance,
    cycleValidation: s.cycleValidation,
    netPositions: [...s.balances.values()].map((b) => ({ memberId: b.memberId, fullName: b.fullName, net: b.totals.netPosition })),
  });
}));

g.get('/settlement/preview', MANAGER, asyncHandler(async (req, res) => {
  res.json(await groups.settlementPreview(req.group!));
}));

g.post('/settlement', MANAGER, asyncHandler(async (req, res) => {
  const entries = await groups.createSettlement(req.group!, actorOf(req));
  flushSoon();
  res.status(201).json({ entries });
}));

g.post('/complete', MANAGER, asyncHandler(async (req, res) => {
  const group = await groups.completeGroup(req.group!, actorOf(req));
  res.json({ group: serializeGroup(group) });
}));

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
g.get('/members', asyncHandler(async (req, res) => {
  const manager = isManager(req);
  const members = await prisma.groupMember.findMany({ where: { groupId: req.group!.id }, orderBy: [{ rotationOrder: 'asc' }, { joinedAt: 'asc' }] });
  const s = await loadGroupState(prisma, req.group!.id, now());
  res.json({
    members: members.map((m) => {
      const b = s.balances.get(m.id)!;
      const self = m.id === req.membership!.id;
      return {
        ...serializeMember(m, { manager, self }),
        paymentStatus: b.paymentStatus,
        potStatus: b.potStatus,
        // private balances only for managers or self; everyone sees shared status
        ...(manager || self ? { netPosition: b.totals.netPosition, arrears: b.arrears, lateFeeOutstanding: b.lateFeeOutstanding } : {}),
      };
    }),
  });
}));

g.post('/members', MANAGER, validate(addMemberSchema), asyncHandler(async (req, res) => {
  const m = await groups.addMember(req.group!, req.body, actorOf(req));
  res.status(201).json({ member: serializeMember(m, { manager: true, self: false }) });
}));

g.post('/members/:memberId/invitation', MANAGER, asyncHandler(async (req, res) => {
  const invitation = await groups.issueMemberInvitation(req.group!, req.params.memberId, actorOf(req));
  res.status(201).json(invitation);
}));

g.patch('/members/:memberId', validate(updateMemberSchema), asyncHandler(async (req, res) => {
  const m = await groups.updateMember(req.group!, req.membership!, req.params.memberId, req.body, actorOf(req));
  res.json({ member: serializeMember(m, { manager: isManager(req), self: m.id === req.membership!.id }) });
}));

g.delete('/members/:memberId', MANAGER, validate(reasonSchema), asyncHandler(async (req, res) => {
  await groups.removeMember(req.group!, req.params.memberId, req.body.reason, actorOf(req));
  res.status(204).end();
}));

g.post('/members/:memberId/status', MANAGER, validate(memberStatusSchema), asyncHandler(async (req, res) => {
  const m = await groups.changeMemberStatus(req.group!, req.params.memberId, req.body.status, req.body.reason, actorOf(req));
  flushSoon();
  res.json({ member: serializeMember(m, { manager: true, self: false }) });
}));

g.get('/members/:memberId/balance', asyncHandler(async (req, res) => {
  if (!isManager(req) && req.params.memberId !== req.membership!.id) throw forbidden('You can only view your own balance');
  const s = await loadGroupState(prisma, req.group!.id, now());
  const b = s.balances.get(req.params.memberId);
  if (!b) throw notFound('Member');
  res.json({ balance: b });
}));

g.get('/members/:memberId/exit-quote', asyncHandler(async (req, res) => {
  if (!isManager(req) && req.params.memberId !== req.membership!.id) throw forbidden();
  res.json(await groups.exitQuote(req.group!, req.params.memberId));
}));

g.post('/members/:memberId/exit', MANAGER, validate(exitSchema), asyncHandler(async (req, res) => {
  const result = await groups.exitMember(req.group!, req.params.memberId, req.body, actorOf(req));
  res.json(result);
}));

g.post('/members/:memberId/photo', uploadLimiter, singleUpload('photo', 'photos'), asyncHandler(async (req, res) => {
  const key = fileKeyOf(req);
  if (!key) throw notFound('Uploaded photo');
  if (!key.match(/\.(jpg|png|webp)$/)) throw forbidden('Profile photo must be an image');
  const m = await groups.updateMember(req.group!, req.membership!, req.params.memberId, { profilePhotoPath: key }, actorOf(req));
  res.json({ member: serializeMember(m, { manager: isManager(req), self: m.id === req.membership!.id }) });
}));

g.get('/members/:memberId/photo', asyncHandler(async (req, res) => {
  const m = await prisma.groupMember.findFirst({ where: { id: req.params.memberId, groupId: req.group!.id } });
  if (!m?.profilePhotoPath || !(await storage.exists(m.profilePhotoPath))) throw notFound('Photo');
  res.setHeader('Content-Type', mimeForKey(m.profilePhotoPath));
  res.setHeader('Cache-Control', 'private, max-age=300');
  storage.open(m.profilePhotoPath).pipe(res);
}));

// ---------------------------------------------------------------------------
// Reminders (manual trigger; the scheduler runs them daily)
// ---------------------------------------------------------------------------
g.post('/reminders/run', MANAGER, asyncHandler(async (req, res) => {
  const result = await runReminders(now(), req.group!.id);
  res.json(result);
}));

g.use('/rounds', roundsRouter);
g.use(ledgerRouter);
g.use(reportsRouter);
