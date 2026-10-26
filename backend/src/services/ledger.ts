import type { EntryType, GroupMember, LedgerEntry, PaymentMethod } from '@prisma/client';
import { prisma, Tx } from '../lib/prisma';
import { audit } from '../lib/audit';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { now } from '../lib/clock';
import { formatNpr } from '../domain/money';
import { loadGroupState } from './state';
import { notifyMembers } from './notifications';
import { refreshRoundCollectionStatus, type Actor } from './rounds';

const TX_OPTS = { timeout: 20000, maxWait: 10000 } as const;

export const MEMBER_SUBMITTABLE: EntryType[] = ['CONTRIBUTION', 'LATE_FEE', 'PENALTY'];
export const MANAGER_RECORDABLE: EntryType[] = ['CONTRIBUTION', 'LATE_FEE', 'PENALTY', 'REFUND', 'MANUAL_ADJUSTMENT'];
const ROUND_REQUIRED: EntryType[] = ['CONTRIBUTION', 'LATE_FEE'];

export interface CreateEntryInput {
  memberId: string;
  roundId?: string | null;
  type: EntryType;
  amount: number;
  method: PaymentMethod;
  referenceNumber?: string;
  proofUrl?: string;
  receiptPath?: string;
  paidAt: Date;
  notes?: string;
  verify?: boolean;
  cashReceivedInPerson?: boolean;
}

/** Open round that receives newly verified cash (null during settlement). */
async function currentLedgerRoundId(tx: Tx, groupId: string): Promise<string | null> {
  const r = await tx.round.findFirst({
    where: { groupId, status: { in: ['COLLECTING', 'PAYOUT_PENDING', 'DISPUTED'] } },
    orderBy: { roundNumber: 'asc' },
    select: { id: true },
  });
  return r?.id ?? null;
}

export async function createEntry(groupId: string, caller: GroupMember, input: CreateEntryInput, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const group = await tx.group.findUniqueOrThrow({ where: { id: groupId } });
    if (group.status !== 'ACTIVE' && group.status !== 'SETTLEMENT') throw unprocessable('Payments can only be recorded after the group has started');
    const isManager = caller.role === 'ORGANIZER' || caller.role === 'CO_ORGANIZER';
    if (input.cashReceivedInPerson && !isManager) throw forbidden('Only organizers can confirm cash received in person');
    if (input.cashReceivedInPerson && (input.method !== 'CASH' || !['CONTRIBUTION', 'LATE_FEE', 'PENALTY'].includes(input.type))) {
      throw unprocessable('In-person cash confirmation is only available for cash contributions, late fees, or penalties');
    }
    if (caller.role === 'VIEWER') throw forbidden('Viewers have read-only access');
    if (!isManager) {
      if (input.memberId !== caller.id) throw forbidden('Members can only submit payments for themselves');
      if (!MEMBER_SUBMITTABLE.includes(input.type)) throw forbidden('Members can only submit contributions, late fees and penalties');
      if (input.verify) throw forbidden('Only organizers can verify payments');
      if (!input.receiptPath && !input.proofUrl) throw unprocessable('Please upload a receipt/screenshot or link the payment proof');
    } else if (!MANAGER_RECORDABLE.includes(input.type)) {
      throw unprocessable(`${input.type} entries are created through their dedicated workflow (payout / correction / bidding)`);
    }
    if (input.paidAt.getTime() > now().getTime() + 5 * 60 * 1000) throw unprocessable('Payment date cannot be in the future');

    const member = await tx.groupMember.findFirst({ where: { id: input.memberId, groupId } });
    if (!member) throw notFound('Member');
    if (!member.isContributor) throw unprocessable('This person is not a contributing member');
    if (ROUND_REQUIRED.includes(input.type) && !input.roundId) throw unprocessable(`roundId is required for ${input.type}`);

    if (input.roundId) {
      const round = await tx.round.findFirst({ where: { id: input.roundId, groupId } });
      if (!round) throw notFound('Round');
      if (round.status === 'UPCOMING') throw unprocessable('This round has not opened yet');
      const state = await loadGroupState(tx, groupId, now());
      const rs = state.balances.get(member.id)?.rounds.find((r) => r.roundId === round.id);
      if (input.type === 'CONTRIBUTION') {
        if (!rs) throw unprocessable('Member has no contribution obligation in this round');
        const room = rs.amountDue - rs.paid - rs.pending;
        if (input.amount > room) {
          throw unprocessable(`Amount exceeds what is still owed for round ${round.roundNumber} (${formatNpr(Math.max(0, room), group.currency)} including pending submissions)`);
        }
      }
      if (input.type === 'LATE_FEE') {
        const pendingFees = state.entries
          .filter((e) => e.memberId === member.id && e.roundId === round.id && e.type === 'LATE_FEE' && e.status === 'PENDING')
          .reduce((a, e) => a + e.amount, 0);
        const room = (rs?.lateFeeOutstanding ?? 0) - pendingFees;
        if (input.amount > room) throw unprocessable(`Late fee exceeds the assessed outstanding late fee (${formatNpr(Math.max(0, room), group.currency)})`);
      }
    }
    if (input.type === 'MANUAL_ADJUSTMENT' && !input.notes?.trim()) throw unprocessable('A reason (notes) is required for manual adjustments');
    if (input.type !== 'MANUAL_ADJUSTMENT' && input.amount <= 0) throw unprocessable('Amount must be positive');

    const hasProof = !!(input.receiptPath || input.proofUrl);
    const autoVerify = input.type === 'MANUAL_ADJUSTMENT' || (input.verify && isManager) || !!input.cashReceivedInPerson;
    if (autoVerify && input.type !== 'MANUAL_ADJUSTMENT' && !hasProof) {
      if (!input.cashReceivedInPerson) throw unprocessable('Upload or link payment proof, or confirm cash received in person');
    }
    const ledgerRoundId = autoVerify ? await currentLedgerRoundId(tx, groupId) : null;
    const entry = await tx.ledgerEntry.create({
      data: {
        groupId,
        roundId: input.roundId ?? null,
        memberId: member.id,
        type: input.type,
        amount: input.amount,
        method: input.method,
        referenceNumber: input.referenceNumber,
        proofUrl: input.proofUrl,
        receiptPath: input.receiptPath,
        cashReceivedInPerson: !!input.cashReceivedInPerson,
        paidAt: input.paidAt,
        notes: input.notes,
        recordedById: actor.userId,
        ...(autoVerify ? { status: 'VERIFIED' as const, verifiedById: actor.userId, verifiedAt: now(), ledgerRoundId } : {}),
      },
    });
    await audit(tx, {
      groupId, userId: actor.userId, action: 'PAYMENT_RECORDED', entityType: 'LedgerEntry', entityId: entry.id,
      newValue: entrySnapshot(entry), reason: input.cashReceivedInPerson ? 'Organizer confirmed cash received in person without a receipt' : input.type === 'MANUAL_ADJUSTMENT' ? input.notes : null, ipAddress: actor.ip,
    });
    if (autoVerify) {
      await audit(tx, { groupId, userId: actor.userId, action: 'PAYMENT_VERIFIED', entityType: 'LedgerEntry', entityId: entry.id, oldValue: { status: 'PENDING' }, newValue: { status: 'VERIFIED', cashReceivedInPerson: !!input.cashReceivedInPerson }, reason: input.cashReceivedInPerson ? 'Cash received in person; no receipt provided' : undefined, ipAddress: actor.ip });
      await notifyMembers(tx, verifiedNotice(group.id, group.currency, entry));
      if (entry.roundId && entry.type === 'CONTRIBUTION') await refreshRoundCollectionStatus(tx, entry.roundId);
    }
    return entry;
  }, TX_OPTS);
}

function entrySnapshot(e: LedgerEntry) {
  return {
    seq: e.seq, type: e.type, amount: e.amount, memberId: e.memberId, roundId: e.roundId, method: e.method,
    referenceNumber: e.referenceNumber, status: e.status, paidAt: e.paidAt, hasReceipt: !!e.receiptPath, proofUrl: e.proofUrl,
    cashReceivedInPerson: e.cashReceivedInPerson,
  };
}

function verifiedNotice(groupId: string, currency: string, e: LedgerEntry) {
  return {
    groupId,
    memberIds: [e.memberId],
    type: 'PAYMENT_VERIFIED' as const,
    roundId: e.roundId,
    title: `Payment verified / भुक्तानी प्रमाणित भयो (#${e.seq})`,
    body: `Your ${e.type.replace('_', ' ').toLowerCase()} of ${formatNpr(Math.abs(e.amount), currency)} (transaction #${e.seq}) has been verified.`,
  };
}

export async function attachProof(groupId: string, entryId: string, caller: GroupMember, proof: { receiptPath?: string; proofUrl?: string }, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.ledgerEntry.findFirst({ where: { id: entryId, groupId } });
    if (!entry) throw notFound('Transaction');
    const isManager = caller.role === 'ORGANIZER' || caller.role === 'CO_ORGANIZER';
    if (!isManager && entry.memberId !== caller.id) throw forbidden();
    if (entry.status !== 'PENDING') throw conflict('Proof can only be attached to pending transactions');
    if (!proof.receiptPath && !proof.proofUrl) throw unprocessable('Provide a receipt file or a proof URL');
    const updated = await tx.ledgerEntry.update({
      where: { id: entryId },
      data: { receiptPath: proof.receiptPath ?? entry.receiptPath, proofUrl: proof.proofUrl ?? entry.proofUrl },
    });
    await audit(tx, {
      groupId, userId: actor.userId, action: 'PROOF_ATTACHED', entityType: 'LedgerEntry', entityId: entryId,
      oldValue: { hasReceipt: !!entry.receiptPath, proofUrl: entry.proofUrl }, newValue: { hasReceipt: !!updated.receiptPath, proofUrl: updated.proofUrl }, ipAddress: actor.ip,
    });
    return updated;
  }, TX_OPTS);
}

export async function verifyEntry(groupId: string, entryId: string, cashReceivedInPerson: boolean, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ledger_entries" WHERE id = ${entryId} FOR UPDATE`;
    const entry = await tx.ledgerEntry.findFirst({ where: { id: entryId, groupId } });
    if (!entry) throw notFound('Transaction');
    if (entry.status !== 'PENDING') throw conflict(`Transaction is already ${entry.status}`);
    if (cashReceivedInPerson && (entry.method !== 'CASH' || !['CONTRIBUTION', 'LATE_FEE', 'PENALTY'].includes(entry.type))) {
      throw unprocessable('In-person cash confirmation is only available for cash contributions, late fees, or penalties');
    }
    if (!entry.receiptPath && !entry.proofUrl && !cashReceivedInPerson) throw unprocessable('Upload or link payment proof, or confirm cash received in person');
    const group = await tx.group.findUniqueOrThrow({ where: { id: groupId } });
    if (entry.type === 'CONTRIBUTION' && entry.roundId) {
      const state = await loadGroupState(tx, groupId, now());
      const rs = state.balances.get(entry.memberId)?.rounds.find((r) => r.roundId === entry.roundId);
      if (rs && entry.amount > rs.amountDue - rs.paid) throw unprocessable('Verifying this would exceed the amount due for the round. Reject it instead.');
    }
    const ledgerRoundId = await currentLedgerRoundId(tx, groupId);
    const updated = await tx.ledgerEntry.update({
      where: { id: entryId },
      data: { status: 'VERIFIED', verifiedById: actor.userId, verifiedAt: now(), ledgerRoundId, cashReceivedInPerson },
    });
    await audit(tx, { groupId, userId: actor.userId, action: 'PAYMENT_VERIFIED', entityType: 'LedgerEntry', entityId: entryId, oldValue: { status: 'PENDING' }, newValue: { status: 'VERIFIED', ledgerRoundId, cashReceivedInPerson }, reason: cashReceivedInPerson ? 'Organizer confirmed cash received in person without a receipt' : undefined, ipAddress: actor.ip });
    await notifyMembers(tx, verifiedNotice(groupId, group.currency, updated));
    if (updated.roundId && updated.type === 'CONTRIBUTION') await refreshRoundCollectionStatus(tx, updated.roundId);
    return updated;
  }, TX_OPTS);
}

export async function rejectEntry(groupId: string, entryId: string, reason: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ledger_entries" WHERE id = ${entryId} FOR UPDATE`;
    const entry = await tx.ledgerEntry.findFirst({ where: { id: entryId, groupId } });
    if (!entry) throw notFound('Transaction');
    if (entry.status !== 'PENDING') throw conflict(`Only pending transactions can be rejected. Use a correction entry for ${entry.status} transactions.`);
    const group = await tx.group.findUniqueOrThrow({ where: { id: groupId } });
    const updated = await tx.ledgerEntry.update({ where: { id: entryId }, data: { status: 'REJECTED', rejectedReason: reason, verifiedById: actor.userId } });
    if (entry.type === 'POT_PAYOUT' && entry.roundId) {
      const round = await tx.round.findUnique({ where: { id: entry.roundId } });
      if (round?.payoutEntryId === entry.id) {
        await tx.round.update({ where: { id: round.id }, data: { payoutEntryId: null, status: round.status === 'PAYOUT_PENDING' ? 'COLLECTING' : round.status } });
      }
    }
    await audit(tx, { groupId, userId: actor.userId, action: 'PAYMENT_REJECTED', entityType: 'LedgerEntry', entityId: entryId, oldValue: { status: 'PENDING' }, newValue: { status: 'REJECTED' }, reason, ipAddress: actor.ip });
    await notifyMembers(tx, {
      groupId, memberIds: [entry.memberId], type: 'PAYMENT_REJECTED', roundId: entry.roundId,
      title: `Payment rejected / भुक्तानी अस्वीकृत (#${entry.seq})`,
      body: `Your ${entry.type.replace('_', ' ').toLowerCase()} of ${formatNpr(entry.amount, group.currency)} (transaction #${entry.seq}) was rejected. Reason: ${reason}`,
    });
    return updated;
  }, TX_OPTS);
}

/**
 * Verified entries are immutable; mistakes are fixed with a CORRECTION entry
 * holding a signed delta against the original. Corrections are verified
 * immediately (they carry a mandatory reason and are fully audited + notified).
 */
export async function createCorrection(tx: Tx, groupId: string, originalId: string, amount: number, reason: string, actor: Actor) {
  const original = await tx.ledgerEntry.findFirst({ where: { id: originalId, groupId }, include: { corrections: true } });
  if (!original) throw notFound('Transaction');
  if (original.status !== 'VERIFIED') throw conflict('Only verified transactions can be corrected. Reject pending ones instead.');
  if (original.type === 'CORRECTION' || original.type === 'BID_DISCOUNT') throw unprocessable(`${original.type} entries cannot be corrected directly`);
  if (amount === 0) throw unprocessable('Correction amount cannot be zero');
  const currentNet = original.amount + original.corrections.filter((c) => c.status === 'VERIFIED').reduce((a, c) => a + c.amount, 0);
  if (original.type !== 'MANUAL_ADJUSTMENT' && currentNet + amount < 0) throw unprocessable('Correction would make the corrected amount negative');
  const group = await tx.group.findUniqueOrThrow({ where: { id: groupId } });
  const ledgerRoundId = await currentLedgerRoundId(tx, groupId);
  const correction = await tx.ledgerEntry.create({
    data: {
      groupId, roundId: original.roundId, ledgerRoundId, memberId: original.memberId, type: 'CORRECTION', amount,
      method: original.method, paidAt: now(), recordedById: actor.userId, verifiedById: actor.userId, verifiedAt: now(),
      status: 'VERIFIED', notes: reason, correctsEntryId: original.id,
    },
  });
  await audit(tx, {
    groupId, userId: actor.userId, action: 'CORRECTION_RECORDED', entityType: 'LedgerEntry', entityId: correction.id,
    oldValue: { originalId: original.id, originalSeq: original.seq, effectiveAmount: currentNet },
    newValue: { delta: amount, effectiveAmount: currentNet + amount },
    reason, ipAddress: actor.ip,
  });
  await notifyMembers(tx, {
    groupId, memberIds: [original.memberId], type: 'GENERAL', roundId: original.roundId,
    title: `Correction recorded / सुधार प्रविष्टि (#${original.seq})`,
    body: `A correction of ${formatNpr(amount, group.currency)} was recorded against transaction #${original.seq}. Reason: ${reason}`,
  });
  return correction;
}

export async function correctEntry(groupId: string, originalId: string, amount: number, reason: string, actor: Actor) {
  return prisma.$transaction((tx) => createCorrection(tx, groupId, originalId, amount, reason, actor), TX_OPTS);
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------
export async function openDispute(groupId: string, entryId: string, caller: GroupMember, reason: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.ledgerEntry.findFirst({ where: { id: entryId, groupId } });
    if (!entry) throw notFound('Transaction');
    const isManager = caller.role === 'ORGANIZER' || caller.role === 'CO_ORGANIZER';
    if (caller.role === 'VIEWER') throw forbidden('Viewers have read-only access');
    if (!isManager && entry.memberId !== caller.id) throw forbidden('You can only dispute your own transactions');
    const existing = await tx.dispute.findFirst({ where: { entryId, status: 'OPEN' } });
    if (existing) throw conflict('There is already an open dispute for this transaction');
    const dispute = await tx.dispute.create({ data: { groupId, entryId, raisedByUserId: actor.userId, reason } });
    const roundId = entry.roundId ?? entry.ledgerRoundId;
    if (roundId) {
      const round = await tx.round.findUnique({ where: { id: roundId } });
      if (round && ['COLLECTING', 'PAYOUT_PENDING'].includes(round.status)) {
        await tx.round.update({ where: { id: roundId }, data: { status: 'DISPUTED', statusBeforeDispute: round.status } });
        await audit(tx, { groupId, userId: actor.userId, action: 'ROUND_STATUS_CHANGED', entityType: 'Round', entityId: roundId, oldValue: { status: round.status }, newValue: { status: 'DISPUTED' }, ipAddress: actor.ip });
      }
    }
    await audit(tx, { groupId, userId: actor.userId, action: 'DISPUTE_OPENED', entityType: 'Dispute', entityId: dispute.id, newValue: { entryId, entrySeq: entry.seq }, reason, ipAddress: actor.ip });
    const managers = await tx.groupMember.findMany({ where: { groupId, role: { in: ['ORGANIZER', 'CO_ORGANIZER'] } }, select: { id: true } });
    await notifyMembers(tx, {
      groupId, memberIds: managers.map((m) => m.id), type: 'DISPUTE_OPENED', roundId,
      title: `Dispute opened on transaction #${entry.seq} / उजुरी दर्ता`,
      body: `A dispute was opened on transaction #${entry.seq}. Reason: ${reason}`,
    });
    return dispute;
  }, TX_OPTS);
}

export async function resolveDispute(
  groupId: string,
  disputeId: string,
  input: { outcome: 'UPHELD' | 'DISMISSED'; resolution: string; correctionAmount?: number },
  actor: Actor,
) {
  return prisma.$transaction(async (tx) => {
    const dispute = await tx.dispute.findFirst({ where: { id: disputeId, groupId }, include: { entry: true } });
    if (!dispute) throw notFound('Dispute');
    if (dispute.status !== 'OPEN') throw conflict('Dispute is already resolved');
    let correctionEntryId: string | null = null;
    if (input.correctionAmount) {
      if (input.outcome !== 'UPHELD') throw unprocessable('A correction can only accompany an upheld dispute');
      const c = await createCorrection(tx, groupId, dispute.entryId, input.correctionAmount, `Dispute resolution: ${input.resolution}`, actor);
      correctionEntryId = c.id;
    }
    const resolved = await tx.dispute.update({
      where: { id: disputeId },
      data: { status: 'RESOLVED', outcome: input.outcome, resolution: input.resolution, resolvedById: actor.userId, resolvedAt: now(), correctionEntryId },
    });
    const roundId = dispute.entry.roundId ?? dispute.entry.ledgerRoundId;
    if (roundId) {
      const stillOpen = await tx.dispute.count({ where: { groupId, status: 'OPEN', entry: { OR: [{ roundId }, { ledgerRoundId: roundId }] } } });
      const round = await tx.round.findUnique({ where: { id: roundId } });
      if (!stillOpen && round?.status === 'DISPUTED') {
        const restored = round.statusBeforeDispute ?? 'COLLECTING';
        await tx.round.update({ where: { id: roundId }, data: { status: restored, statusBeforeDispute: null } });
        await audit(tx, { groupId, userId: actor.userId, action: 'ROUND_STATUS_CHANGED', entityType: 'Round', entityId: roundId, oldValue: { status: 'DISPUTED' }, newValue: { status: restored }, ipAddress: actor.ip });
      }
    }
    await audit(tx, {
      groupId, userId: actor.userId, action: 'DISPUTE_RESOLVED', entityType: 'Dispute', entityId: disputeId,
      oldValue: { status: 'OPEN' }, newValue: { status: 'RESOLVED', outcome: input.outcome, correctionEntryId },
      reason: input.resolution, ipAddress: actor.ip,
    });
    const raiser = await tx.groupMember.findFirst({ where: { groupId, userId: dispute.raisedByUserId } });
    const notifyIds = [...new Set([dispute.entry.memberId, raiser?.id].filter((x): x is string => !!x))];
    await notifyMembers(tx, {
      groupId, memberIds: notifyIds, type: 'DISPUTE_RESOLVED', roundId,
      title: `Dispute resolved / उजुरी समाधान (#${dispute.entry.seq})`,
      body: `Outcome: ${input.outcome}. ${input.resolution}`,
    });
    return resolved;
  }, TX_OPTS);
}
