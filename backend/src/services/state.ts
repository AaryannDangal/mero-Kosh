/**
 * Builds the complete computed state of a group from the database:
 * per-member totals, per-round payment status, arrears, late fees, remaining
 * contributions and the group fund balance. Everything is derived from
 * immutable ledger entries + round obligations - nothing is cached.
 */
import type { EntryType, Group, GroupMember, LedgerEntry, MemberExit, Round, RoundObligation, PotObligation } from '@prisma/client';
import type { Db } from '../lib/prisma';
import {
  assessRoundLateFee,
  computeMemberTotals,
  dayNumber,
  MemberTotals,
  paymentStatus,
  PaymentStatusT,
  validateCycleZeroSum,
  CycleValidation,
  selectContributors,
  calculatePotRecipientObligation,
  potMonthlyInterest,
  PotObligationResult,
} from '../domain/calculations';
import { notFound } from '../lib/errors';

export type RoundWithObligations = Round & { obligations: RoundObligation[] };
export type MemberWithExit = GroupMember & { exit: MemberExit | null };
export type EntryWithTarget = LedgerEntry & { corrects: Pick<LedgerEntry, 'type' | 'roundId'> | null };

export interface MemberRoundState {
  roundId: string;
  roundNumber: number;
  dueDate: Date;
  contributionDue: number;
  discountCredit: number;
  amountDue: number;
  paid: number;
  pending: number;
  outstanding: number;
  status: PaymentStatusT;
  lateFeeAssessed: number;
  lateFeePaid: number;
  lateFeeOutstanding: number;
  daysLate: number;
  settledAt: Date | null;
}

export type PotStatus = 'WAITING_FOR_TURN' | 'RECEIVED_POT' | 'COMPLETED';

export interface MemberBalance {
  memberId: string;
  fullName: string;
  status: GroupMember['status'];
  role: GroupMember['role'];
  isContributor: boolean;
  rotationOrder: number | null;
  hasReceivedPot: boolean;
  totals: MemberTotals;
  totalDiscountCredits: number; // includes credits of the open round (from obligations)
  rounds: MemberRoundState[];
  arrears: number; // unpaid contributions for rounds whose due date has passed
  overdueAmount: number; // unpaid after the grace period
  lateFeeAssessed: number;
  lateFeePaid: number;
  lateFeeOutstanding: number;
  remainingContributions: number;
  pendingAmount: number;
  nextDue: { roundId: string; roundNumber: number; dueDate: Date; amountDue: number; outstanding: number } | null;
  paymentStatus: PaymentStatusT | 'NOT_APPLICABLE';
  potStatus: PotStatus;
  potObligation?: PotObligationResult & {
    initialPotAmount: number;
    cumulativePrincipalRepaid: number;
    cumulativeAdvanceRepayments: number;
  } | null;
}

export interface GroupState {
  group: Group;
  members: MemberWithExit[];
  rounds: RoundWithObligations[];
  entries: EntryWithTarget[];
  balances: Map<string, MemberBalance>;
  currentRound: RoundWithObligations | null;
  fundBalance: number;
  cycleValidation: CycleValidation;
  asOf: Date;
}

const CONTRIB_TYPES: EntryType[] = ['CONTRIBUTION'];

/**
 * Pot-interest payments and lump-sum pot repayments are money that repays the pot,
 * not the round contribution, so they are tracked apart from the round obligation.
 */
export function isPotRepaymentEntry(e: { notes?: string | null }): boolean {
  const notes = e.notes ?? '';
  return notes.includes('POT_INTEREST') || notes.includes('ADVANCE_POT_REPAYMENT') || notes.includes('ADVANCE_POT_RETURN');
}

/** effective type of an entry (corrections inherit the type of their target) */
export function effectiveType(e: EntryWithTarget): EntryType {
  if (e.type === 'CORRECTION') return e.corrects?.type ?? 'MANUAL_ADJUSTMENT';
  return e.type;
}

export async function loadGroupState(db: Db, groupId: string, asOf: Date): Promise<GroupState> {
  const group = await db.group.findUnique({ where: { id: groupId } });
  if (!group) throw notFound('Group');
  const [members, rounds, entries, potObligations] = await Promise.all([
    db.groupMember.findMany({ where: { groupId }, include: { exit: true }, orderBy: [{ rotationOrder: 'asc' }, { joinedAt: 'asc' }] }),
    db.round.findMany({ where: { groupId }, include: { obligations: true }, orderBy: { roundNumber: 'asc' } }),
    db.ledgerEntry.findMany({ where: { groupId }, include: { corrects: { select: { type: true, roundId: true } } }, orderBy: { seq: 'asc' } }),
    db.potObligation.findMany({ where: { groupId }, orderBy: { createdAt: 'asc' } }),
  ]);
  return computeGroupState(group, members, rounds, entries, potObligations, asOf);
}

export function computeGroupState(
  group: Group,
  members: MemberWithExit[],
  rounds: RoundWithObligations[],
  entries: EntryWithTarget[],
  potObligations: PotObligation[],
  asOf: Date,
): GroupState {
  const currentRound = rounds.find((r) => r.status === 'COLLECTING' || r.status === 'PAYOUT_PENDING' || r.status === 'DISPUTED') ?? null;
  const lateRule = { type: group.lateFeeType, value: group.lateFeeValue, cap: group.lateFeeCap };
  const balances = new Map<string, MemberBalance>();

  for (const m of members) {
    const mine = entries.filter((e) => e.memberId === m.id);
    const totals = computeMemberTotals(
      mine.map((e) => ({ type: e.type, amount: e.amount, status: e.status, correctsType: e.corrects?.type ?? null })),
    );
    const roundStates: MemberRoundState[] = [];
    for (const r of rounds) {
      const ob = r.obligations.find((o) => o.memberId === m.id);
      if (!ob) continue;
      const contribEntries = mine.filter((e) => {
        const roundId = e.type === 'CORRECTION' ? e.corrects?.roundId ?? e.roundId : e.roundId;
        return roundId === r.id && CONTRIB_TYPES.includes(effectiveType(e)) && !isPotRepaymentEntry(e);
      });
      const verified = contribEntries.filter((e) => e.status === 'VERIFIED');
      const pending = contribEntries.filter((e) => e.status === 'PENDING').reduce((a, e) => a + e.amount, 0);
      const amountDue = ob.contributionDue - ob.discountCredit;
      const lateAssess = assessRoundLateFee({
        amountDue,
        dueDate: r.dueDate,
        gracePeriodDays: group.gracePeriodDays,
        payments: verified.map((e) => ({ amount: e.amount, paidAt: e.paidAt })),
        asOf,
        rule: lateRule,
      });
      const paid = verified.reduce((a, e) => a + e.amount, 0);
      const lateFeePaid = mine
        .filter((e) => e.status === 'VERIFIED' && effectiveType(e) === 'LATE_FEE' && (e.type === 'CORRECTION' ? e.corrects?.roundId : e.roundId) === r.id)
        .reduce((a, e) => a + e.amount, 0);
      roundStates.push({
        roundId: r.id,
        roundNumber: r.roundNumber,
        dueDate: r.dueDate,
        contributionDue: ob.contributionDue,
        discountCredit: ob.discountCredit,
        amountDue,
        paid,
        pending,
        outstanding: Math.max(0, amountDue - paid),
        status: paymentStatus({ amountDue, paid, dueDate: r.dueDate, gracePeriodDays: group.gracePeriodDays, asOf }),
        lateFeeAssessed: lateAssess.lateFee,
        lateFeePaid,
        lateFeeOutstanding: Math.max(0, lateAssess.lateFee - lateFeePaid),
        daysLate: lateAssess.daysLate,
        settledAt: lateAssess.settledAt,
      });
    }

    const pastDue = roundStates.filter((rs) => dayNumber(asOf) > dayNumber(rs.dueDate));
    const arrears = pastDue.reduce((a, rs) => a + rs.outstanding, 0);
    const overdueAmount = roundStates.filter((rs) => rs.status === 'OVERDUE').reduce((a, rs) => a + rs.outstanding, 0);
    const lateFeeAssessed = roundStates.reduce((a, rs) => a + rs.lateFeeAssessed, 0);
    const lateFeePaid = roundStates.reduce((a, rs) => a + rs.lateFeePaid, 0);
    const lateFeeOutstanding = roundStates.reduce((a, rs) => a + rs.lateFeeOutstanding, 0);

    // future (not yet opened) rounds this member will owe
    const owesFuture = memberOwesFutureContributions(m, group.continueAfterPot);
    const upcoming = rounds.filter((r) => r.status === 'UPCOMING');
    let futureRounds = 0;
    if (owesFuture) {
      if (!group.continueAfterPot && !m.hasReceivedPot && group.selectionMethod === 'FIXED_ROTATION' && m.rotationOrder) {
        futureRounds = upcoming.filter((r) => r.roundNumber <= m.rotationOrder!).length;
      } else {
        futureRounds = upcoming.length; // upper bound for bidding groups
      }
    }
    const remainingContributions = roundStates.reduce((a, rs) => a + rs.outstanding, 0) + futureRounds * group.contributionAmount;

    const currentState = currentRound ? roundStates.find((rs) => rs.roundId === currentRound.id) : undefined;
    const firstUnpaid = roundStates.find((rs) => rs.outstanding > 0);
    const nextDue = firstUnpaid
      ? { roundId: firstUnpaid.roundId, roundNumber: firstUnpaid.roundNumber, dueDate: firstUnpaid.dueDate, amountDue: firstUnpaid.amountDue, outstanding: firstUnpaid.outstanding }
      : (() => {
        const next = owesFuture ? upcoming[0] : undefined;
        return next ? { roundId: next.id, roundNumber: next.roundNumber, dueDate: next.dueDate, amountDue: group.contributionAmount, outstanding: group.contributionAmount } : null;
      })();

    let overall: MemberBalance['paymentStatus'] = 'NOT_APPLICABLE';
    if (roundStates.some((rs) => rs.status === 'OVERDUE')) overall = 'OVERDUE';
    else if (currentState) overall = currentState.status;
    else if (roundStates.length) overall = roundStates.every((rs) => rs.status === 'PAID') ? 'PAID' : 'PARTIAL';

    let potObligation: any = null;
    const allObligations = potObligations;
    const myObligations = allObligations
      .filter((po: PotObligation) => po.memberId === m.id)
      .sort((a: PotObligation, b: PotObligation) => {
        const roundA = rounds.find((r) => r.id === a.roundId)?.roundNumber ?? 0;
        const roundB = rounds.find((r) => r.id === b.roundId)?.roundNumber ?? 0;
        return roundA - roundB;
      });

    if (myObligations.length > 0 || m.hasReceivedPot) {
      const cumulativeAdvanceRepayments = mine
        .filter((e) => e.status === 'VERIFIED' && (e.notes?.includes('ADVANCE_POT_REPAYMENT') || e.notes?.includes('ADVANCE_POT_RETURN')))
        .reduce((a, e) => a + e.amount, 0);

      // Track remaining principal per obligation
      const tracked = myObligations.map((po) => {
        const winRound = rounds.find((r) => r.id === po.roundId);
        return {
          roundNumber: winRound?.roundNumber ?? 0,
          originalAmount: po.originalAmount,
          remaining: po.remainingPrincipal,
          monthlyInterest: potMonthlyInterest(po.originalAmount, po.interestRateBp),
        };
      });

      // 1. Apply advance repayments to oldest obligations first
      let advRemaining = cumulativeAdvanceRepayments;
      for (const t of tracked) {
        if (advRemaining <= 0) break;
        const deduction = Math.min(t.remaining, advRemaining);
        t.remaining -= deduction;
        advRemaining -= deduction;
      }

      // 2. Apply regular round contributions in order of rounds
      let cumulativePrincipalRepaid = 0;
      for (const rs of [...roundStates].sort((a, b) => a.roundNumber - b.roundNumber)) {
        const activeBeforeRound = tracked.filter((t) => t.roundNumber < rs.roundNumber && t.remaining > 0);
        if (activeBeforeRound.length === 0) continue;

        const totalActiveInterest = activeBeforeRound.reduce((sum: number, t: any) => sum + t.monthlyInterest, 0);
        const paid = Math.max(0, rs.paid);
        const interestCovered = Math.min(totalActiveInterest, Math.max(0, paid - group.contributionAmount));
        let principalCredit = Math.max(0, paid - interestCovered);
        cumulativePrincipalRepaid += principalCredit;

        for (const t of activeBeforeRound) {
          if (principalCredit <= 0) break;
          const deduction = Math.min(t.remaining, principalCredit);
          t.remaining -= deduction;
          principalCredit -= deduction;
        }
      }

      const totalInitialPot = tracked.reduce((sum: number, t: any) => sum + t.originalAmount, 0);
      const totalRemainingPrincipal = tracked.reduce((sum: number, t: any) => sum + Math.max(0, t.remaining), 0);
      const activePots = tracked.filter((t: any) => t.remaining > 0);
      const totalMonthlyInterest = activePots.reduce((sum: number, t: any) => sum + t.monthlyInterest, 0);

      potObligation = {
        remainingPotPrincipal: totalRemainingPrincipal,
        monthlyInterest: totalMonthlyInterest,
        principalInstallment: Math.min(totalRemainingPrincipal, group.contributionAmount),
        totalMonthlyDue: group.contributionAmount + totalMonthlyInterest,
        explanation: totalRemainingPrincipal <= 0
          ? 'Pot amount fully returned. Regular monthly contribution due.'
          : `Remaining principal: ${totalRemainingPrincipal} paisa. Interest across ${activePots.length} active pot(s): ${totalMonthlyInterest} paisa. Monthly due: ${group.contributionAmount + totalMonthlyInterest} paisa.`,
        initialPotAmount: totalInitialPot,
        cumulativePrincipalRepaid,
        cumulativeAdvanceRepayments,
      };
    }

    const allClosed = rounds.length > 0 && rounds.every((r) => r.status === 'COMPLETED');
    balances.set(m.id, {
      memberId: m.id,
      fullName: m.fullName,
      status: m.status,
      role: m.role,
      isContributor: m.isContributor,
      rotationOrder: m.rotationOrder,
      hasReceivedPot: m.hasReceivedPot,
      totals,
      totalDiscountCredits: roundStates.reduce((a, rs) => a + rs.discountCredit, 0),
      rounds: roundStates,
      arrears,
      overdueAmount,
      lateFeeAssessed,
      lateFeePaid,
      lateFeeOutstanding,
      remainingContributions,
      pendingAmount: mine.filter((e) => e.status === 'PENDING').reduce((a, e) => a + e.amount, 0),
      nextDue,
      paymentStatus: overall,
      potStatus: m.hasReceivedPot ? (allClosed ? 'COMPLETED' : 'RECEIVED_POT') : 'WAITING_FOR_TURN',
      potObligation,
    });
  }

  const nets = [...balances.values()].map((b) => b.totals.netPosition);
  const fundBalance = nets.reduce((a, b) => a + b, 0);
  return {
    group,
    members,
    rounds,
    entries,
    balances,
    currentRound,
    fundBalance,
    cycleValidation: validateCycleZeroSum(nets),
    asOf,
  };
}

/** Does this member keep owing contributions in rounds that open from now on? */
export function memberOwesFutureContributions(m: MemberWithExit, continueAfterPot: boolean): boolean {
  return selectContributors([{ ...m, exitSettlement: m.exit?.settlement ?? null }], continueAfterPot).length === 1;
}

/** Arrears from rounds before `roundNumber` (used for winner eligibility). */
export function arrearsBefore(b: MemberBalance, roundNumber: number): number {
  return b.rounds.filter((rs) => rs.roundNumber < roundNumber).reduce((a, rs) => a + rs.outstanding, 0);
}

export function currentUnpaid(b: MemberBalance, roundId: string): number {
  return b.rounds.find((rs) => rs.roundId === roundId)?.outstanding ?? 0;
}

/** Cash movements recorded into a round's cash book (ledgerRoundId). */
export function roundCashFlows(entries: EntryWithTarget[], roundId: string | null) {
  const flows = { contributions: 0, lateFees: 0, penalties: 0, payouts: 0, refunds: 0, adjustments: 0 };
  const byMethod: Record<string, { in: number; out: number }> = {};
  for (const e of entries) {
    if (e.status !== 'VERIFIED' || e.ledgerRoundId !== roundId) continue;
    const t = effectiveType(e);
    let signed = 0;
    switch (t) {
      case 'CONTRIBUTION': flows.contributions += e.amount; signed = e.amount; break;
      case 'LATE_FEE': flows.lateFees += e.amount; signed = e.amount; break;
      case 'PENALTY': flows.penalties += e.amount; signed = e.amount; break;
      case 'POT_PAYOUT': flows.payouts += e.amount; signed = -e.amount; break;
      case 'REFUND': flows.refunds += e.amount; signed = -e.amount; break;
      case 'MANUAL_ADJUSTMENT': flows.adjustments += e.amount; signed = e.amount; break;
      default: break; // BID_DISCOUNT is a non-cash credit
    }
    if (signed !== 0) {
      const k = e.method;
      byMethod[k] ??= { in: 0, out: 0 };
      if (signed > 0) byMethod[k].in += signed;
      else byMethod[k].out += -signed;
    }
  }
  return { ...flows, byMethod };
}
