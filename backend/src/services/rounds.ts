import type { Group, Round } from '@prisma/client';
import { prisma, Tx } from '../lib/prisma';
import { audit } from '../lib/audit';
import { conflict, notFound, unprocessable } from '../lib/errors';
import { now } from '../lib/clock';
import {
  bidLimits,
  calculateBidDistribution,
  calculateFullPot,
  generateSchedule,
  reconcileRound,
  selectBidWinner,
  selectContributors,
  validateBidAmount,
  winnerIneligibilityReason,
  dayNumber,
} from '../domain/calculations';
import { formatNpr } from '../domain/money';
import { arrearsBefore, currentUnpaid, loadGroupState, roundCashFlows } from './state';
import { notifyMembers } from './notifications';

export interface Actor {
  userId: string;
  ip?: string | null;
}

/** Row-level lock to serialise concurrent operations on the same round. */
async function lockRound(tx: Tx, roundId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "rounds" WHERE id = ${roundId} FOR UPDATE`;
}

async function lockGroup(tx: Tx, groupId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "groups" WHERE id = ${groupId} FOR UPDATE`;
}

const TX_OPTS = { timeout: 20000, maxWait: 10000 } as const;

// ---------------------------------------------------------------------------
// Start the group: generate all rounds and open round 1
// ---------------------------------------------------------------------------
export async function startGroup(groupId: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    const group = await tx.group.findUniqueOrThrow({ where: { id: groupId } });
    if (group.status !== 'DRAFT') throw conflict('Group has already started');
    if (!group.rulesConfirmedAt) throw unprocessable('The organizer must confirm the group rules before the first round starts');
    const contributors = await tx.groupMember.findMany({
      where: { groupId, isContributor: true, status: { not: 'EXITED' } },
      orderBy: [{ rotationOrder: 'asc' }, { joinedAt: 'asc' }],
    });
    if (contributors.length !== group.memberCount) {
      throw unprocessable(`The group needs exactly ${group.memberCount} contributing members to start (currently ${contributors.length})`);
    }
    // assign rotation order: keep explicit ones, fill gaps in join order
    const used = new Set(contributors.map((c) => c.rotationOrder).filter((x): x is number => x != null));
    if ([...used].some((o) => o < 1 || o > group.memberCount)) throw unprocessable('Rotation order must be between 1 and the number of members');
    let next = 1;
    for (const c of contributors.filter((c) => c.rotationOrder == null)) {
      while (used.has(next)) next++;
      await tx.groupMember.update({ where: { id: c.id }, data: { rotationOrder: next } });
      used.add(next);
    }
    await tx.groupMember.updateMany({ where: { groupId, isContributor: true, status: 'ACTIVE' }, data: { status: 'WAITING' } });

    const schedule = generateSchedule(group.startDate, group.frequency, group.collectionDueDay, group.memberCount);
    for (const s of schedule) {
      await tx.round.create({
        data: {
          groupId,
          roundNumber: s.roundNumber,
          periodLabel: s.periodLabel,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          dueDate: s.dueDate,
          selectionMethod: group.selectionMethod,
        },
      });
    }
    await audit(tx, { groupId, userId: actor.userId, action: 'ROUND_CREATED', entityType: 'Group', entityId: groupId, newValue: { rounds: schedule.length }, ipAddress: actor.ip });
    const updated = await tx.group.update({ where: { id: groupId }, data: { status: 'ACTIVE' } });
    await audit(tx, { groupId, userId: actor.userId, action: 'GROUP_STARTED', entityType: 'Group', entityId: groupId, oldValue: { status: 'DRAFT' }, newValue: { status: 'ACTIVE' }, ipAddress: actor.ip });
    const first = await tx.round.findFirstOrThrow({ where: { groupId, roundNumber: 1 } });
    await openRound(tx, updated, first, 0, actor);
    return updated;
  }, TX_OPTS);
}

// ---------------------------------------------------------------------------
// Open a round: compute pot + obligations, assign fixed-rotation winner
// ---------------------------------------------------------------------------
export async function openRound(tx: Tx, group: Group, round: Round, openingBalance: number, actor: Actor) {
  if (round.status !== 'UPCOMING') throw conflict(`Round ${round.roundNumber} is already open`);
  const members = await tx.groupMember.findMany({
    where: { groupId: group.id },
    include: { exit: true },
    orderBy: [{ rotationOrder: 'asc' }, { joinedAt: 'asc' }],
  });
  const contributors = selectContributors(
    members.map((m) => ({ ...m, exitSettlement: m.exit?.settlement ?? null })),
    group.continueAfterPot,
  );
  const fullPot = calculateFullPot(group.contributionAmount, contributors.length);

  for (const c of contributors) {
    await tx.roundObligation.create({ data: { roundId: round.id, memberId: c.id, contributionDue: group.contributionAmount } });
  }

  const waiting = members.filter((m) => m.isContributor && !m.hasReceivedPot && m.status !== 'EXITED');
  const data: Partial<Round> & Record<string, unknown> = {
    status: 'COLLECTING',
    openedAt: now(),
    contributorCount: contributors.length,
    fullPot,
    openingBalance,
    expectedCollection: fullPot,
  };

  let winnerId: string | null = null;
  if (group.selectionMethod === 'FIXED_ROTATION') {
    const candidate = waiting.filter((m) => m.status !== 'SUSPENDED' && m.status !== 'DEFAULTED')[0] ?? waiting[0];
    if (candidate) {
      winnerId = candidate.id;
      Object.assign(data, { winnerMemberId: candidate.id, winnerSelectedAt: now(), payoutToWinner: fullPot, bidDiscount: 0, biddingStatus: 'NOT_APPLICABLE' });
    }
  } else if (group.selectionMethod === 'BIDDING' && waiting.length <= 1) {
    // last remaining member: no auction is possible, they receive the full pot
    const last = waiting[0];
    if (last) {
      winnerId = last.id;
      Object.assign(data, { winnerMemberId: last.id, winnerSelectedAt: now(), payoutToWinner: fullPot, bidDiscount: 0, biddingStatus: 'CLOSED', discountRecipientCount: 0 });
    }
  } else if (group.selectionMethod === 'BIDDING') {
    Object.assign(data, { biddingStatus: 'OPEN' });
  }

  const opened = await tx.round.update({ where: { id: round.id }, data });
  await audit(tx, {
    groupId: group.id, userId: actor.userId, action: 'ROUND_OPENED', entityType: 'Round', entityId: round.id,
    newValue: { roundNumber: round.roundNumber, fullPot, contributors: contributors.length, openingBalance, winnerMemberId: winnerId, biddingStatus: opened.biddingStatus },
    ipAddress: actor.ip,
  });
  await notifyMembers(tx, {
    groupId: group.id,
    memberIds: contributors.map((c) => c.id),
    type: 'GENERAL',
    roundId: round.id,
    title: `Round ${round.roundNumber} is open / चरण ${round.roundNumber} सुरु भयो`,
    body: `Round ${round.roundNumber} of "${group.name}" is now collecting. Contribution ${formatNpr(group.contributionAmount, group.currency)} is due on ${round.dueDate.toISOString().slice(0, 10)}.${opened.biddingStatus === 'OPEN' ? ' Sealed bidding is open.' : ''}`,
  });
  if (winnerId) await notifyWinner(tx, group, opened, winnerId);
  return opened;
}

export async function requestPot(groupId: string, roundId: string, memberId: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    const round = await tx.round.findFirst({ where: { id: roundId, groupId } });
    if (!round) throw notFound('Round');
    if (round.selectionMethod !== 'ADMIN_SELECTION') throw unprocessable('This group does not use member requests');
    if (!['COLLECTING', 'PAYOUT_PENDING'].includes(round.status) || round.winnerMemberId) throw conflict('Requests are closed for this round');
    const member = await tx.groupMember.findFirst({ where: { id: memberId, groupId } });
    if (!member) throw notFound('Member');
    const state = await loadGroupState(tx, groupId, now());
    const balance = state.balances.get(memberId);
    const ineligibility = balance ? winnerIneligibilityReason(
      { status: balance.status, isContributor: balance.isContributor, hasReceivedPot: balance.hasReceivedPot, arrears: arrearsBefore(balance, round.roundNumber), currentRoundUnpaid: 0 },
      false,
    ) : 'member is not eligible';
    if (ineligibility) throw unprocessable(`You are not eligible to request this pot: ${ineligibility}`);
    const existing = await tx.potRequest.findUnique({ where: { roundId_memberId: { roundId, memberId } } });
    if (existing) return existing;
    const request = await tx.potRequest.create({ data: { groupId, roundId, memberId } });
    await audit(tx, { groupId, userId: actor.userId, action: 'POT_REQUESTED', entityType: 'PotRequest', entityId: request.id, newValue: { roundId, memberId }, ipAddress: actor.ip });
    return request;
  }, TX_OPTS);
}

export async function withdrawPotRequest(groupId: string, roundId: string, memberId: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    const round = await tx.round.findFirst({ where: { id: roundId, groupId } });
    if (!round) throw notFound('Round');
    if (round.winnerMemberId || !['COLLECTING', 'PAYOUT_PENDING'].includes(round.status)) throw conflict('Requests are closed for this round');
    const request = await tx.potRequest.findUnique({ where: { roundId_memberId: { roundId, memberId } } });
    if (!request) return;
    await tx.potRequest.delete({ where: { id: request.id } });
    await audit(tx, { groupId, userId: actor.userId, action: 'POT_REQUEST_WITHDRAWN', entityType: 'PotRequest', entityId: request.id, oldValue: { roundId, memberId }, ipAddress: actor.ip });
  }, TX_OPTS);
}

async function notifyWinner(tx: Tx, group: Group, round: Round, winnerId: string) {
  await notifyMembers(tx, {
    groupId: group.id,
    memberIds: [winnerId],
    type: 'WINNER_SELECTED',
    roundId: round.id,
    dedupeKey: `winner:${round.id}`,
    title: `You are the pot recipient for round ${round.roundNumber} / तपाईं चरण ${round.roundNumber} को ढुकुटी प्राप्तकर्ता हुनुभयो`,
    body: `You have been selected to receive the pot of round ${round.roundNumber} in "${group.name}". Expected payout: ${formatNpr(round.payoutToWinner ?? 0, group.currency)}. Make sure all your contributions are paid.`,
  });
}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------
export async function getBidLimits(groupId: string, roundId: string) {
  const round = await prisma.round.findFirst({ where: { id: roundId, groupId }, include: { obligations: true } });
  if (!round) throw notFound('Round');
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
  const members = await prisma.groupMember.findMany({ where: { groupId } });
  return computeLimits(group, round, members);
}

function computeLimits(
  group: Group,
  round: Round & { obligations: { memberId: string; contributionDue: number }[] },
  members: { id: string; hasReceivedPot: boolean; isContributor: boolean; status: string }[],
  excludeWinnerId?: string,
) {
  const waitingIds = new Set(members.filter((m) => m.isContributor && !m.hasReceivedPot && m.status !== 'EXITED').map((m) => m.id));
  // recipients exclude the eventual winner -> use the smallest contribution among waiting members as conservative bound
  const recipientObligations = round.obligations.filter((o) => waitingIds.has(o.memberId) && o.memberId !== excludeWinnerId);
  const totalIfOneWins = recipientObligations.reduce((a, o) => a + o.contributionDue, 0)
    - (excludeWinnerId ? 0 : Math.max(0, ...recipientObligations.map((o) => o.contributionDue)));
  return bidLimits({ fullPot: round.fullPot ?? 0, minBidDiscount: group.minBidDiscount, recipientContributionTotal: Math.max(0, totalIfOneWins) });
}

export async function submitBid(groupId: string, roundId: string, memberId: string, discountAmount: number, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    const round = await tx.round.findFirst({ where: { id: roundId, groupId }, include: { obligations: true } });
    if (!round) throw notFound('Round');
    const group = await tx.group.findUniqueOrThrow({ where: { id: groupId } });
    if (group.selectionMethod !== 'BIDDING') throw unprocessable('This group does not use bidding');
    if (round.biddingStatus !== 'OPEN') throw conflict('Bidding is not open for this round');
    if (dayNumber(now()) > dayNumber(round.dueDate)) throw conflict('Bidding closed on the due date');
    const state = await loadGroupState(tx, groupId, now());
    const b = state.balances.get(memberId);
    if (!b) throw notFound('Member');
    const reason = winnerIneligibilityReason(
      { status: b.status, isContributor: b.isContributor, hasReceivedPot: b.hasReceivedPot, arrears: arrearsBefore(b, round.roundNumber), currentRoundUnpaid: 0 },
      false,
    );
    if (reason) throw unprocessable(`You are not eligible to bid: ${reason}`);
    const limits = computeLimits(group, round, state.members);
    const v = validateBidAmount(discountAmount, limits);
    if (!v.ok) throw unprocessable(v.reason, { limits });

    const existing = await tx.bid.findUnique({ where: { roundId_memberId: { roundId, memberId } } });
    const bid = existing
      ? await tx.bid.update({ where: { id: existing.id }, data: { discountAmount, submittedAt: now() } })
      : await tx.bid.create({ data: { roundId, memberId, discountAmount, submittedAt: now() } });
    await audit(tx, {
      groupId, userId: actor.userId, action: existing ? 'BID_CHANGED' : 'BID_SUBMITTED', entityType: 'Bid', entityId: bid.id,
      // amounts are sealed: audit stores them, but they are only exposed to managers after reveal
      oldValue: existing ? { discountAmount: existing.discountAmount } : null,
      newValue: { roundNumber: round.roundNumber, memberId, discountAmount },
      ipAddress: actor.ip,
    });
    return { bid, limits };
  }, TX_OPTS);
}

export async function withdrawBid(groupId: string, roundId: string, memberId: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    const round = await tx.round.findFirst({ where: { id: roundId, groupId } });
    if (!round) throw notFound('Round');
    if (round.biddingStatus !== 'OPEN') throw conflict('Bidding is not open');
    const existing = await tx.bid.findUnique({ where: { roundId_memberId: { roundId, memberId } } });
    if (!existing) throw notFound('Bid');
    await tx.bid.delete({ where: { id: existing.id } });
    await audit(tx, { groupId, userId: actor.userId, action: 'BID_WITHDRAWN', entityType: 'Bid', entityId: existing.id, oldValue: { discountAmount: existing.discountAmount, memberId }, ipAddress: actor.ip });
  }, TX_OPTS);
}

/** Close sealed bidding, select the winner, reveal bids and compute discount shares. */
export async function closeBidding(groupId: string, roundId: string, actor: Actor, rng: () => number = Math.random) {
  return prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    const round = await tx.round.findFirst({ where: { id: roundId, groupId }, include: { obligations: true, bids: true } });
    if (!round) throw notFound('Round');
    const group = await tx.group.findUniqueOrThrow({ where: { id: groupId } });
    if (round.biddingStatus !== 'OPEN') throw conflict('Bidding is not open for this round');
    const state = await loadGroupState(tx, groupId, now());
    const eligibleBids = round.bids.filter((bid) => {
      const b = state.balances.get(bid.memberId);
      return b && !winnerIneligibilityReason(
        { status: b.status, isContributor: b.isContributor, hasReceivedPot: b.hasReceivedPot, arrears: arrearsBefore(b, round.roundNumber), currentRoundUnpaid: 0 },
        false,
      );
    });
    if (!eligibleBids.length) throw unprocessable('No eligible bids. The organizer can select a winner manually with a reason.');
    const selection = selectBidWinner(
      eligibleBids.map((b) => ({ memberId: b.memberId, discountAmount: b.discountAmount, submittedAt: b.submittedAt })),
      group.bidWinRule,
      group.tieBreakRule,
      rng,
    );
    const result = await applyBiddingWinner(tx, group, round.id, selection.winner.memberId, selection.winner.discountAmount, actor);
    await audit(tx, {
      groupId, userId: actor.userId, action: 'BIDDING_CLOSED', entityType: 'Round', entityId: round.id,
      newValue: {
        bids: round.bids.map((b) => ({ memberId: b.memberId, discountAmount: b.discountAmount, submittedAt: b.submittedAt })),
        excludedIneligible: round.bids.filter((b) => !eligibleBids.includes(b)).map((b) => b.memberId),
        winner: selection.winner.memberId,
        tiedMemberIds: selection.tiedMemberIds,
        tieBreak: selection.tieBroken ? group.tieBreakRule : null,
      },
      ipAddress: actor.ip,
    });
    return result;
  }, TX_OPTS);
}

async function applyBiddingWinner(tx: Tx, group: Group, roundId: string, winnerId: string, discount: number, actor: Actor) {
  const round = await tx.round.findUniqueOrThrow({ where: { id: roundId }, include: { obligations: true } });
  const members = await tx.groupMember.findMany({ where: { groupId: group.id }, orderBy: [{ rotationOrder: 'asc' }, { joinedAt: 'asc' }] });
  const limits = computeLimits(group, round, members, winnerId);
  const v = validateBidAmount(discount, limits);
  if (!v.ok) throw unprocessable(v.reason);
  const recipients = members
    .filter((m) => m.isContributor && !m.hasReceivedPot && m.status !== 'EXITED' && m.id !== winnerId)
    .filter((m) => round.obligations.some((o) => o.memberId === m.id));
  const dist = calculateBidDistribution(round.fullPot ?? 0, discount, recipients.map((r) => r.id));

  // reset credits (supports override) then apply
  await tx.roundObligation.updateMany({ where: { roundId }, data: { discountCredit: 0 } });
  for (const s of dist.shares) {
    await tx.roundObligation.update({ where: { roundId_memberId: { roundId, memberId: s.memberId } }, data: { discountCredit: s.amount } });
  }
  await tx.bid.updateMany({ where: { roundId }, data: { isWinning: false } });
  await tx.bid.updateMany({ where: { roundId, memberId: winnerId }, data: { isWinning: true } });
  const updated = await tx.round.update({
    where: { id: roundId },
    data: {
      winnerMemberId: winnerId,
      winnerSelectedAt: now(),
      biddingStatus: 'CLOSED',
      bidDiscount: dist.bidDiscount,
      payoutToWinner: dist.payoutToWinner,
      discountRecipientCount: dist.recipientCount,
      discountSharePerMember: dist.sharePerMember,
      expectedCollection: (round.fullPot ?? 0) - dist.bidDiscount,
    },
  });
  await audit(tx, {
    groupId: group.id, userId: actor.userId, action: 'WINNER_SELECTED', entityType: 'Round', entityId: roundId,
    oldValue: round.winnerMemberId ? { winnerMemberId: round.winnerMemberId, bidDiscount: round.bidDiscount } : null,
    newValue: { winnerMemberId: winnerId, bidDiscount: dist.bidDiscount, payoutToWinner: dist.payoutToWinner, shares: dist.shares },
    ipAddress: actor.ip,
  });
  await notifyWinner(tx, group, updated, winnerId);
  await notifyMembers(tx, {
    groupId: group.id,
    memberIds: dist.shares.map((s) => s.memberId),
    type: 'GENERAL',
    roundId,
    title: `Bids revealed for round ${round.roundNumber} / चरण ${round.roundNumber} को बोल सार्वजनिक`,
    body: `The winning discount is ${formatNpr(dist.bidDiscount, group.currency)}. Your share (${formatNpr(dist.sharePerMember, group.currency)} approx.) has been credited against this round's contribution.`,
  });
  return updated;
}

/**
 * Manual override of the pot recipient. A reason is mandatory and stored in the
 * audit log. Eligibility rules still apply (cannot pick someone with arrears or
 * who already received the pot). Not allowed after a payout has been recorded.
 */
export async function overrideWinner(
  groupId: string,
  roundId: string,
  input: { memberId: string; reason: string; bidDiscount?: number },
  actor: Actor,
) {
  return prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    const round = await tx.round.findFirst({ where: { id: roundId, groupId } });
    if (!round) throw notFound('Round');
    if (!['COLLECTING', 'PAYOUT_PENDING', 'DISPUTED'].includes(round.status)) throw conflict('Winner can only be changed while the round is open');
    if (round.payoutEntryId) throw conflict('A payout is already recorded for this round. Reject the pending payout first.');
    const group = await tx.group.findUniqueOrThrow({ where: { id: groupId } });
    const state = await loadGroupState(tx, groupId, now());
    const b = state.balances.get(input.memberId);
    if (!b) throw notFound('Member');
    const reason = winnerIneligibilityReason(
      { status: b.status, isContributor: b.isContributor, hasReceivedPot: b.hasReceivedPot, arrears: arrearsBefore(b, round.roundNumber), currentRoundUnpaid: 0 },
      false,
    );
    if (reason) throw unprocessable(`Selected member is not eligible: ${reason}`);
    await audit(tx, {
      groupId, userId: actor.userId, action: 'MANUAL_OVERRIDE', entityType: 'Round', entityId: roundId,
      oldValue: { winnerMemberId: round.winnerMemberId, bidDiscount: round.bidDiscount, biddingStatus: round.biddingStatus },
      newValue: { winnerMemberId: input.memberId, bidDiscount: input.bidDiscount ?? null },
      reason: input.reason,
      ipAddress: actor.ip,
    });
    if (group.selectionMethod === 'BIDDING') {
      let discount = input.bidDiscount;
      if (discount === undefined) {
        const bid = await tx.bid.findUnique({ where: { roundId_memberId: { roundId, memberId: input.memberId } } });
        discount = bid?.discountAmount ?? group.minBidDiscount;
      }
      const updated = await applyBiddingWinner(tx, group, roundId, input.memberId, discount, actor);
      return tx.round.update({ where: { id: updated.id }, data: { selectionOverrideReason: input.reason } });
    }
    const updated = await tx.round.update({
      where: { id: roundId },
      data: { winnerMemberId: input.memberId, winnerSelectedAt: now(), selectionOverrideReason: input.reason },
    });
    await notifyWinner(tx, group, updated, input.memberId);
    return updated;
  }, TX_OPTS);
}

// ---------------------------------------------------------------------------
// Payout
// ---------------------------------------------------------------------------
export interface PayoutInput {
  amount: number;
  method: 'CASH' | 'BANK_TRANSFER' | 'ESEWA' | 'KHALTI' | 'OTHER';
  referenceNumber?: string;
  proofUrl?: string;
  receiptPath?: string;
  paidAt: Date;
  notes?: string;
  verify?: boolean;
}

export async function recordPayout(groupId: string, roundId: string, input: PayoutInput, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    const round = await tx.round.findFirst({ where: { id: roundId, groupId } });
    if (!round) throw notFound('Round');
    const group = await tx.group.findUniqueOrThrow({ where: { id: groupId } });
    if (!['COLLECTING', 'PAYOUT_PENDING'].includes(round.status)) throw conflict(`Cannot record a payout while the round is ${round.status}`);
    if (!round.winnerMemberId || round.payoutToWinner == null) throw unprocessable('No pot recipient has been selected for this round yet');
    if (round.selectionMethod === 'BIDDING' && round.biddingStatus !== 'CLOSED') throw unprocessable('Close bidding before recording the payout');
    if (round.payoutEntryId) throw conflict('A payout has already been recorded for this round');
    if (input.amount !== round.payoutToWinner) {
      throw unprocessable(`Payout must equal the calculated amount ${round.payoutToWinner} paisa (full pot ${round.fullPot} − bid discount ${round.bidDiscount})`);
    }
    const state = await loadGroupState(tx, groupId, now());
    const b = state.balances.get(round.winnerMemberId)!;
    const reason = winnerIneligibilityReason(
      { status: b.status, isContributor: b.isContributor, hasReceivedPot: b.hasReceivedPot, arrears: arrearsBefore(b, round.roundNumber), currentRoundUnpaid: currentUnpaid(b, round.id) },
      true,
    );
    if (reason) throw unprocessable(`Payout blocked: ${reason}`);
    const hasProof = !!(input.receiptPath || input.proofUrl);
    if (input.verify && !hasProof) throw unprocessable('Upload or link payment proof before verifying the payout');

    const entry = await tx.ledgerEntry.create({
      data: {
        groupId, roundId, memberId: round.winnerMemberId, type: 'POT_PAYOUT', amount: input.amount, method: input.method,
        referenceNumber: input.referenceNumber, receiptPath: input.receiptPath, proofUrl: input.proofUrl, paidAt: input.paidAt,
        notes: input.notes, recordedById: actor.userId,
        ...(input.verify ? { status: 'VERIFIED' as const, verifiedById: actor.userId, verifiedAt: now(), ledgerRoundId: round.id } : {}),
      },
    });
    await tx.round.update({ where: { id: roundId }, data: { payoutEntryId: entry.id, status: 'PAYOUT_PENDING' } });
    await audit(tx, {
      groupId, userId: actor.userId, action: 'PAYOUT_RECORDED', entityType: 'LedgerEntry', entityId: entry.id,
      newValue: { roundNumber: round.roundNumber, memberId: round.winnerMemberId, amount: input.amount, method: input.method, status: entry.status },
      ipAddress: actor.ip,
    });
    if (input.verify) {
      await audit(tx, { groupId, userId: actor.userId, action: 'PAYMENT_VERIFIED', entityType: 'LedgerEntry', entityId: entry.id, oldValue: { status: 'PENDING' }, newValue: { status: 'VERIFIED' }, ipAddress: actor.ip });
    }
    await notifyMembers(tx, {
      groupId, memberIds: [round.winnerMemberId], type: 'PAYOUT_RECORDED', roundId,
      title: `Payout recorded for round ${round.roundNumber} / चरण ${round.roundNumber} को भुक्तानी रेकर्ड भयो`,
      body: `A pot payout of ${formatNpr(input.amount, group.currency)} to you has been recorded (${input.method}${input.referenceNumber ? ', ref ' + input.referenceNumber : ''}). If this is wrong, open a dispute in the app.`,
    });
    return entry;
  }, TX_OPTS);
}

/** Move to PAYOUT_PENDING once everything expected has been collected and verified. */
export async function refreshRoundCollectionStatus(tx: Tx, roundId: string) {
  const round = await tx.round.findUnique({ where: { id: roundId }, include: { obligations: true } });
  if (!round || round.status !== 'COLLECTING' || !round.winnerMemberId) return;
  const state = await loadGroupState(tx, round.groupId, now());
  const allPaid = round.obligations.every((o) => (state.balances.get(o.memberId)?.rounds.find((r) => r.roundId === roundId)?.outstanding ?? 0) === 0);
  if (allPaid) await tx.round.update({ where: { id: roundId }, data: { status: 'PAYOUT_PENDING' } });
}

// ---------------------------------------------------------------------------
// Close round (reconciliation) and open the next one
// ---------------------------------------------------------------------------
export interface CloseRoundInput {
  actualClosingBalance: number;
  mismatchReason?: string;
}

export async function previewReconciliation(groupId: string, roundId: string, actualClosingBalance?: number | null) {
  const state = await loadGroupState(prisma, groupId, now());
  const round = state.rounds.find((r) => r.id === roundId);
  if (!round) throw notFound('Round');
  const flows = roundCashFlows(state.entries, roundId);
  const rec = reconcileRound({
    openingBalance: round.openingBalance,
    totalContributions: flows.contributions,
    lateFees: flows.lateFees + flows.penalties,
    payoutToWinner: flows.payouts,
    otherAdjustments: flows.adjustments - flows.refunds,
    actualClosingBalance: actualClosingBalance ?? round.actualClosingBalance,
  });
  return { flows, reconciliation: rec, expectedCollection: round.expectedCollection, collectionShortfall: (round.expectedCollection ?? 0) - flows.contributions };
}

export async function closeRound(groupId: string, roundId: string, input: CloseRoundInput, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    await lockRound(tx, roundId);
    const round = await tx.round.findFirst({ where: { id: roundId, groupId } });
    if (!round) throw notFound('Round');
    const group = await tx.group.findUniqueOrThrow({ where: { id: groupId } });
    if (round.status === 'DISPUTED') throw conflict('Resolve open disputes before closing this round');
    if (!['COLLECTING', 'PAYOUT_PENDING'].includes(round.status)) throw conflict(`Round is ${round.status} and cannot be closed`);
    const openDisputes = await tx.dispute.count({ where: { groupId, status: 'OPEN', entry: { OR: [{ roundId }, { ledgerRoundId: roundId }] } } });
    if (openDisputes) throw conflict('Resolve open disputes before closing this round');
    if (!round.payoutEntryId) throw unprocessable('Record the pot payout before closing the round');
    const payout = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: round.payoutEntryId } });
    if (payout.status !== 'VERIFIED') throw unprocessable('The pot payout must be verified before closing the round');
    const pendingCount = await tx.ledgerEntry.count({ where: { groupId, roundId, status: 'PENDING' } });
    if (pendingCount) throw unprocessable(`There are ${pendingCount} pending entries for this round. Verify or reject them first.`);

    const state = await loadGroupState(tx, groupId, now());
    const flows = roundCashFlows(state.entries, roundId);
    const rec = reconcileRound({
      openingBalance: round.openingBalance,
      totalContributions: flows.contributions,
      lateFees: flows.lateFees + flows.penalties,
      payoutToWinner: flows.payouts,
      otherAdjustments: flows.adjustments - flows.refunds,
      actualClosingBalance: input.actualClosingBalance,
    });
    if (rec.status === 'MISMATCH' && !input.mismatchReason?.trim()) {
      throw conflict(rec.warning ?? 'Reconciliation mismatch', {
        reconciliation: rec,
        flows,
        expectedCollection: round.expectedCollection,
        collectionShortfall: (round.expectedCollection ?? 0) - flows.contributions,
        hint: 'Fix the ledger, or close anyway by providing mismatchReason (stored in the audit log).',
      });
    }

    // materialise bid discount credits as immutable ledger records
    const obligations = await tx.roundObligation.findMany({ where: { roundId, discountCredit: { gt: 0 } } });
    for (const o of obligations) {
      await tx.ledgerEntry.create({
        data: {
          groupId, roundId, ledgerRoundId: roundId, memberId: o.memberId, type: 'BID_DISCOUNT', amount: o.discountCredit,
          method: 'OTHER', paidAt: now(), recordedById: actor.userId, verifiedById: actor.userId, verifiedAt: now(), status: 'VERIFIED',
          notes: `Bid discount share for round ${round.roundNumber} (non-cash credit against contribution)`,
        },
      });
    }

    const closed = await tx.round.update({
      where: { id: roundId },
      data: {
        status: 'COMPLETED',
        actualCollection: flows.contributions,
        totalLateFees: flows.lateFees + flows.penalties,
        calculatedClosingBalance: rec.calculatedClosingBalance,
        actualClosingBalance: input.actualClosingBalance,
        reconciliationStatus: rec.status === 'NOT_STARTED' ? 'NOT_STARTED' : rec.status,
        reconciliationNote: rec.status === 'MISMATCH' ? input.mismatchReason : null,
        closedAt: now(),
        closedById: actor.userId,
      },
    });
    if (round.winnerMemberId) {
      const w = await tx.groupMember.findUniqueOrThrow({ where: { id: round.winnerMemberId } });
      await tx.groupMember.update({
        where: { id: w.id },
        data: { hasReceivedPot: true, ...(w.status === 'WAITING' || w.status === 'ACTIVE' ? { status: 'RECEIVED_POT' as const } : {}) },
      });
    }
    await audit(tx, {
      groupId, userId: actor.userId, action: 'ROUND_CLOSED', entityType: 'Round', entityId: roundId,
      oldValue: { status: round.status },
      newValue: { status: 'COMPLETED', reconciliation: rec, flows },
      ipAddress: actor.ip,
    });
    if (rec.status === 'MISMATCH') {
      await audit(tx, {
        groupId, userId: actor.userId, action: 'RECONCILIATION_MISMATCH_ACKNOWLEDGED', entityType: 'Round', entityId: roundId,
        newValue: rec, reason: input.mismatchReason, ipAddress: actor.ip,
      });
    }

    // open the next round with the ledger (calculated) balance carried forward
    const next = await tx.round.findFirst({ where: { groupId, roundNumber: { gt: round.roundNumber }, status: 'UPCOMING' }, orderBy: { roundNumber: 'asc' } });
    if (next) {
      await openRound(tx, group, next, rec.calculatedClosingBalance, actor);
    } else {
      await tx.group.update({ where: { id: groupId }, data: { status: 'SETTLEMENT' } });
      await audit(tx, { groupId, userId: actor.userId, action: 'GROUP_UPDATED', entityType: 'Group', entityId: groupId, oldValue: { status: group.status }, newValue: { status: 'SETTLEMENT' }, ipAddress: actor.ip });
    }
    return { round: closed, reconciliation: rec, flows };
  }, TX_OPTS);
}
