/**
 * Pure business calculations for Mero Kosh.
 *
 * Nothing in this file touches the database or the clock (time is always passed
 * in), which makes every rule unit-testable. All amounts are integer paisa.
 */
import { assertInt, distributeEvenly } from './money';

// ---------------------------------------------------------------------------
// Types (kept independent from Prisma so the domain layer has no DB coupling)
// ---------------------------------------------------------------------------
export type MemberStatusT = 'ACTIVE' | 'WAITING' | 'RECEIVED_POT' | 'EXITED' | 'SUSPENDED' | 'DEFAULTED';
export type LateFeeTypeT = 'NONE' | 'FIXED' | 'PERCENTAGE' | 'DAILY';
export type BidWinRuleT = 'HIGHEST_DISCOUNT' | 'LOWEST_DISCOUNT';
export type TieBreakRuleT = 'EARLIEST' | 'RANDOM';
export type FrequencyT = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export type EntryTypeT =
  | 'CONTRIBUTION'
  | 'POT_PAYOUT'
  | 'BID_DISCOUNT'
  | 'LATE_FEE'
  | 'PENALTY'
  | 'REFUND'
  | 'CORRECTION'
  | 'MANUAL_ADJUSTMENT';

export const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 1. Pot calculation
// ---------------------------------------------------------------------------

export interface ContributorCandidate {
  id: string;
  status: MemberStatusT;
  isContributor: boolean;
  hasReceivedPot: boolean;
  /** settlement chosen when the member exited (if any) */
  exitSettlement?: 'PAY_REMAINING' | 'REPLACEMENT' | 'REFUND_AT_CYCLE_END' | null;
}

/**
 * Members who owe a contribution in a newly opened round.
 * - Non-contributing seats (viewers, non-playing organizers) never owe.
 * - Exited members stop owing, EXCEPT a member who already received the pot and
 *   exited under PAY_REMAINING: they keep owing every remaining contribution.
 * - Suspended/defaulted members still owe (status does not erase an obligation).
 * - If `continueAfterPot` is false, members who already received the pot stop contributing.
 */
export function selectContributors<T extends ContributorCandidate>(members: T[], continueAfterPot: boolean): T[] {
  return members.filter((m) => {
    if (!m.isContributor) return false;
    if (m.status === 'EXITED') return m.hasReceivedPot && m.exitSettlement === 'PAY_REMAINING' && continueAfterPot;
    if (!continueAfterPot && m.hasReceivedPot) return false;
    return true;
  });
}

/** Full pot = contribution amount × number of active (contributing) members. */
export function calculateFullPot(contributionAmount: number, activeContributorCount: number): number {
  assertInt(contributionAmount, 'contributionAmount');
  if (contributionAmount <= 0) throw new RangeError('contributionAmount must be positive');
  if (!Number.isInteger(activeContributorCount) || activeContributorCount < 0) {
    throw new RangeError('activeContributorCount must be a non-negative integer');
  }
  return contributionAmount * activeContributorCount;
}

// ---------------------------------------------------------------------------
// 2. Bidding
// ---------------------------------------------------------------------------

export interface BidLimits {
  minDiscount: number;
  maxDiscount: number;
}

/**
 * Bid limits for a round.
 * - minimum: group's minimum discount
 * - maximum: never above the full pot, and never above what the discount
 *   recipients owe this round (the discount is delivered as a credit against
 *   their contribution, so a larger discount could not be distributed).
 */
export function bidLimits(params: {
  fullPot: number;
  minBidDiscount: number;
  recipientContributionTotal: number;
}): BidLimits {
  const maxDiscount = Math.max(0, Math.min(params.fullPot, params.recipientContributionTotal));
  return { minDiscount: params.minBidDiscount, maxDiscount };
}

export function validateBidAmount(amount: number, limits: BidLimits): { ok: true } | { ok: false; reason: string } {
  if (!Number.isSafeInteger(amount)) return { ok: false, reason: 'Bid must be a whole number of paisa' };
  if (amount < limits.minDiscount) return { ok: false, reason: `Bid is below the minimum discount (${limits.minDiscount} paisa)` };
  if (amount > limits.maxDiscount) return { ok: false, reason: `Bid exceeds the maximum allowed discount (${limits.maxDiscount} paisa)` };
  return { ok: true };
}

export interface BidInput {
  memberId: string;
  discountAmount: number;
  submittedAt: Date;
}

export interface BidSelection {
  winner: BidInput;
  tiedMemberIds: string[];
  tieBroken: boolean;
}

/**
 * Select the winning sealed bid.
 * HIGHEST_DISCOUNT: the member accepting the biggest discount wins (standard ROSCA auction).
 * LOWEST_DISCOUNT: the member asking for the smallest discount wins (literal "lowest bid wins").
 * Ties are broken by earliest submission or uniformly at random (rng injectable for tests).
 */
export function selectBidWinner(
  bids: BidInput[],
  rule: BidWinRuleT,
  tieBreak: TieBreakRuleT,
  rng: () => number = Math.random,
): BidSelection {
  if (bids.length === 0) throw new Error('No bids to select from');
  const best = rule === 'HIGHEST_DISCOUNT'
    ? Math.max(...bids.map((b) => b.discountAmount))
    : Math.min(...bids.map((b) => b.discountAmount));
  const tied = bids
    .filter((b) => b.discountAmount === best)
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime() || a.memberId.localeCompare(b.memberId));
  let winner = tied[0];
  if (tied.length > 1 && tieBreak === 'RANDOM') {
    const r = rng();
    const idx = Math.min(tied.length - 1, Math.floor(r * tied.length));
    winner = tied[idx];
  }
  return { winner, tiedMemberIds: tied.map((t) => t.memberId), tieBroken: tied.length > 1 };
}

export interface BidDistribution {
  fullPot: number;
  bidDiscount: number;
  payoutToWinner: number;
  recipientCount: number;
  /** floor(bid_discount / recipients) - the nominal per-member share */
  sharePerMember: number;
  /** exact share per recipient; sums to bidDiscount (remainder paisa go to first recipients) */
  shares: { memberId: string; amount: number }[];
}

/**
 * payout_to_winner = full_pot - bid_discount
 * discount_share_per_remaining_member = bid_discount / members_who_have_not_yet_received_pot
 *
 * `recipientIds` must be the members who have not received the pot (excluding the
 * winner of this round), ordered deterministically (e.g. by rotation order).
 */
export function calculateBidDistribution(fullPot: number, bidDiscount: number, recipientIds: string[]): BidDistribution {
  assertInt(fullPot, 'fullPot');
  assertInt(bidDiscount, 'bidDiscount');
  if (bidDiscount < 0) throw new RangeError('bidDiscount cannot be negative');
  if (bidDiscount > fullPot) throw new RangeError('bidDiscount cannot exceed the full pot');
  if (recipientIds.length === 0 && bidDiscount > 0) {
    throw new RangeError('A discount cannot be applied when no members are waiting for the pot');
  }
  const amounts = distributeEvenly(bidDiscount, recipientIds.length);
  return {
    fullPot,
    bidDiscount,
    payoutToWinner: fullPot - bidDiscount,
    recipientCount: recipientIds.length,
    sharePerMember: recipientIds.length ? Math.floor(bidDiscount / recipientIds.length) : 0,
    shares: recipientIds.map((memberId, i) => ({ memberId, amount: amounts[i] })),
  };
}

// ---------------------------------------------------------------------------
// 3. Winner eligibility
// ---------------------------------------------------------------------------

export interface EligibilityInput {
  status: MemberStatusT;
  isContributor: boolean;
  hasReceivedPot: boolean;
  /** unpaid contributions from earlier rounds */
  arrears: number;
  /** unpaid amount for the current round (only enforced when requireCurrentPaid) */
  currentRoundUnpaid: number;
}

export function winnerIneligibilityReason(m: EligibilityInput, requireCurrentPaid: boolean): string | null {
  if (!m.isContributor) return 'Not a contributing member';
  if (m.status === 'EXITED') return 'Member has exited the group';
  if (m.status === 'SUSPENDED') return 'Member is suspended';
  if (m.status === 'DEFAULTED') return 'Member has defaulted';
  if (m.hasReceivedPot) return 'Member already received the pot in this cycle';
  if (m.arrears > 0) return 'Member has unpaid contributions (arrears)';
  if (requireCurrentPaid && m.currentRoundUnpaid > 0) return 'Member has not paid the current round contribution';
  return null;
}

// ---------------------------------------------------------------------------
// 4. Dates, late fees and payment status
// ---------------------------------------------------------------------------

/** UTC calendar-day number (date-only comparisons, no timezone drift). */
export function dayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
}

export function addDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

/**
 * Days late after the grace period. A payment made on (dueDate + grace) is on time;
 * one day after that is 1 day late.
 */
export function daysLate(dueDate: Date, paidOrAsOf: Date, gracePeriodDays: number): number {
  return Math.max(0, dayNumber(paidOrAsOf) - dayNumber(dueDate) - gracePeriodDays);
}

export interface LateFeeRule {
  type: LateFeeTypeT;
  /** FIXED / DAILY: paisa. PERCENTAGE: basis points (500 = 5%). */
  value: number;
  cap?: number | null;
}

/**
 * Late fee for one member for one round.
 * @param outstandingAtDeadline amount still unpaid at the end of the grace period
 * @param lateDays days late beyond the grace period (until settled or as-of date)
 */
export function calculateLateFee(rule: LateFeeRule, outstandingAtDeadline: number, lateDays: number): number {
  assertInt(outstandingAtDeadline, 'outstandingAtDeadline');
  if (outstandingAtDeadline <= 0 || lateDays <= 0 || rule.type === 'NONE') return 0;
  let fee: number;
  switch (rule.type) {
    case 'FIXED':
      fee = rule.value;
      break;
    case 'PERCENTAGE':
      // round half up to the nearest paisa
      fee = Math.round((outstandingAtDeadline * rule.value) / 10000);
      break;
    case 'DAILY':
      fee = rule.value * lateDays;
      break;
    default:
      fee = 0;
  }
  if (rule.cap != null && rule.cap >= 0) fee = Math.min(fee, rule.cap);
  return fee;
}

export interface DatedPayment {
  amount: number; // may be negative for corrections
  paidAt: Date;
}

export interface RoundLateFeeResult {
  amountDue: number;
  paid: number;
  outstanding: number;
  outstandingAtDeadline: number;
  settledAt: Date | null;
  daysLate: number;
  lateFee: number;
}

/**
 * Assess the late fee for one member/round from the actual payment history.
 * Payments are applied in paidAt order; the obligation is "settled" on the date
 * the cumulative amount reaches the amount due.
 */
export function assessRoundLateFee(params: {
  amountDue: number;
  dueDate: Date;
  gracePeriodDays: number;
  payments: DatedPayment[];
  asOf: Date;
  rule: LateFeeRule;
}): RoundLateFeeResult {
  const { amountDue, dueDate, gracePeriodDays, asOf, rule } = params;
  const payments = [...params.payments].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
  const deadlineDay = dayNumber(dueDate) + gracePeriodDays;
  let cumulative = 0;
  let paidByDeadline = 0;
  let settledAt: Date | null = amountDue <= 0 ? dueDate : null;
  for (const p of payments) {
    if (dayNumber(p.paidAt) > dayNumber(asOf)) continue; // ignore future-dated entries
    cumulative += p.amount;
    if (dayNumber(p.paidAt) <= deadlineDay) paidByDeadline += p.amount;
    if (settledAt === null && cumulative >= amountDue) settledAt = p.paidAt;
  }
  const outstandingAtDeadline = Math.max(0, amountDue - paidByDeadline);
  const lateDays = daysLate(dueDate, settledAt ?? asOf, gracePeriodDays);
  return {
    amountDue,
    paid: cumulative,
    outstanding: Math.max(0, amountDue - cumulative),
    outstandingAtDeadline,
    settledAt,
    daysLate: outstandingAtDeadline > 0 ? lateDays : 0,
    lateFee: calculateLateFee(rule, outstandingAtDeadline, lateDays),
  };
}

export type PaymentStatusT = 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE';

export function paymentStatus(params: {
  amountDue: number;
  paid: number;
  dueDate: Date;
  gracePeriodDays: number;
  asOf: Date;
}): PaymentStatusT {
  const { amountDue, paid, dueDate, gracePeriodDays, asOf } = params;
  if (paid >= amountDue) return 'PAID';
  if (daysLate(dueDate, asOf, gracePeriodDays) > 0) return 'OVERDUE';
  return paid > 0 ? 'PARTIAL' : 'UNPAID';
}

// ---------------------------------------------------------------------------
// 5. Member balances / net position
// ---------------------------------------------------------------------------

export interface LedgerEntryLike {
  type: EntryTypeT;
  amount: number;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  /** for CORRECTION entries: the type of the corrected entry */
  correctsType?: EntryTypeT | null;
}

export interface MemberTotals {
  contributions: number;
  discountCredits: number;
  lateFeesPaid: number;
  penaltiesPaid: number;
  potReceived: number;
  refundsReceived: number;
  adjustments: number;
  /** cash paid into the group fund by the member */
  cashIn: number;
  /** cash paid out of the group fund to the member */
  cashOut: number;
  netPosition: number;
}

/**
 * Aggregate VERIFIED ledger entries into member totals.
 *
 * net_position = contributions + late_fees + penalties + adjustments - pot_received - refunds
 *
 * Bid discounts are reported (discountCredits) but are NOT added to the net
 * position: a discount share is delivered as a credit that reduces the cash the
 * member must contribute, and the winner's payout is already reduced by the same
 * amount. Adding it again would double count it and make Σ net = Σ discounts ≠ 0
 * at the end of the cycle. See README › "Accounting model".
 */
export function computeMemberTotals(entries: LedgerEntryLike[]): MemberTotals {
  const t = {
    contributions: 0,
    discountCredits: 0,
    lateFeesPaid: 0,
    penaltiesPaid: 0,
    potReceived: 0,
    refundsReceived: 0,
    adjustments: 0,
  };
  for (const e of entries) {
    if (e.status !== 'VERIFIED') continue;
    const effective: EntryTypeT = e.type === 'CORRECTION' ? (e.correctsType ?? 'MANUAL_ADJUSTMENT') : e.type;
    switch (effective) {
      case 'CONTRIBUTION': t.contributions += e.amount; break;
      case 'BID_DISCOUNT': t.discountCredits += e.amount; break;
      case 'LATE_FEE': t.lateFeesPaid += e.amount; break;
      case 'PENALTY': t.penaltiesPaid += e.amount; break;
      case 'POT_PAYOUT': t.potReceived += e.amount; break;
      case 'REFUND': t.refundsReceived += e.amount; break;
      case 'MANUAL_ADJUSTMENT': t.adjustments += e.amount; break;
      default: break;
    }
  }
  const cashIn = t.contributions + t.lateFeesPaid + t.penaltiesPaid + Math.max(0, t.adjustments);
  const cashOut = t.potReceived + t.refundsReceived + Math.max(0, -t.adjustments);
  return { ...t, cashIn, cashOut, netPosition: netPosition(t) };
}

export function netPosition(t: {
  contributions: number;
  lateFeesPaid: number;
  penaltiesPaid: number;
  adjustments: number;
  potReceived: number;
  refundsReceived: number;
}): number {
  return t.contributions + t.lateFeesPaid + t.penaltiesPaid + t.adjustments - t.potReceived - t.refundsReceived;
}

export interface CycleValidation {
  sumOfNetPositions: number;
  isZero: boolean;
  error: string | null;
}

/** At the end of a complete cycle Σ net positions must be exactly zero. */
export function validateCycleZeroSum(netPositions: number[]): CycleValidation {
  const sum = netPositions.reduce((a, b) => a + b, 0);
  return {
    sumOfNetPositions: sum,
    isZero: sum === 0,
    error: sum === 0
      ? null
      : `Sum of member net positions is ${sum} paisa, expected 0. ${sum > 0
        ? 'The fund still holds money that must be paid out or refunded.'
        : 'More was paid out than collected - a contribution is missing or a payout is wrong.'}`,
  };
}

// ---------------------------------------------------------------------------
// 6. Round reconciliation
// ---------------------------------------------------------------------------

export interface ReconciliationInput {
  openingBalance: number;
  totalContributions: number;
  /** late fees + penalties */
  lateFees: number;
  payoutToWinner: number;
  /** refunds issued and manual adjustments (signed, + adds to fund) */
  otherAdjustments?: number;
  actualClosingBalance?: number | null;
}

export interface ReconciliationResult {
  calculatedClosingBalance: number;
  actualClosingBalance: number | null;
  difference: number | null;
  status: 'BALANCED' | 'MISMATCH' | 'NOT_STARTED';
  warning: string | null;
}

/**
 * opening_balance + total_contributions + late_fees - payout_to_winner (+ other) = closing_balance
 */
export function reconcileRound(i: ReconciliationInput): ReconciliationResult {
  const calculated = i.openingBalance + i.totalContributions + i.lateFees - i.payoutToWinner + (i.otherAdjustments ?? 0);
  if (i.actualClosingBalance == null) {
    return { calculatedClosingBalance: calculated, actualClosingBalance: null, difference: null, status: 'NOT_STARTED', warning: null };
  }
  const diff = i.actualClosingBalance - calculated;
  return {
    calculatedClosingBalance: calculated,
    actualClosingBalance: i.actualClosingBalance,
    difference: diff,
    status: diff === 0 ? 'BALANCED' : 'MISMATCH',
    warning: diff === 0
      ? null
      : `Reconciliation mismatch: calculated closing balance is ${calculated} paisa but actual balance entered is ${i.actualClosingBalance} paisa (difference ${diff}).`,
  };
}

// ---------------------------------------------------------------------------
// 7. Schedule
// ---------------------------------------------------------------------------

export interface RoundSchedule {
  roundNumber: number;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  periodLabel: string;
}

function daysInMonthUTC(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Generate the collection schedule.
 * MONTHLY: period r starts on startDate + (r-1) months; due on `dueDay` of the
 *          period's month (or the next month if that day is before the period start).
 * WEEKLY/BIWEEKLY: period r starts at startDate + (r-1)·7/14 days; due on the first
 *          `dueDay` weekday (0=Sun) on/after the period start.
 */
export function generateSchedule(startDate: Date, frequency: FrequencyT, dueDay: number, rounds: number): RoundSchedule[] {
  const out: RoundSchedule[] = [];
  for (let r = 1; r <= rounds; r++) {
    let periodStart: Date;
    let nextStart: Date;
    let dueDate: Date;
    if (frequency === 'MONTHLY') {
      const y = startDate.getUTCFullYear();
      const m = startDate.getUTCMonth() + (r - 1);
      const d = startDate.getUTCDate();
      periodStart = new Date(Date.UTC(y, m, Math.min(d, daysInMonthUTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12))));
      nextStart = new Date(Date.UTC(y, m + 1, Math.min(d, daysInMonthUTC(y + Math.floor((m + 1) / 12), (((m + 1) % 12) + 12) % 12))));
      let due = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), dueDay));
      if (dayNumber(due) < dayNumber(periodStart)) {
        due = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, dueDay));
      }
      dueDate = due;
    } else {
      const step = frequency === 'WEEKLY' ? 7 : 14;
      periodStart = addDays(startDate, (r - 1) * step);
      nextStart = addDays(startDate, r * step);
      const offset = (dueDay - periodStart.getUTCDay() + 7) % 7;
      dueDate = addDays(periodStart, offset);
    }
    const periodEnd = addDays(nextStart, -1);
    const label = frequency === 'MONTHLY'
      ? `${MONTHS[periodStart.getUTCMonth()]} ${periodStart.getUTCFullYear()}`
      : `${periodStart.toISOString().slice(0, 10)} – ${periodEnd.toISOString().slice(0, 10)}`;
    out.push({ roundNumber: r, periodStart, periodEnd, dueDate, periodLabel: label });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 8. Early exit
// ---------------------------------------------------------------------------

export interface ExitQuoteInput {
  hasReceivedPot: boolean;
  contributionsPaid: number; // cash contributions
  potReceived: number;
  arrears: number;
  lateFeesOwed: number;
  /** contributions still owed for rounds that have not opened yet */
  futureContributions: number;
  earlyExitPenaltyBp: number;
  netPosition: number;
}

export interface ExitQuote {
  remainingContributions: number;
  penalty: number;
  amountOwedByMember: number;
  amountOwedToMember: number;
  requiredAction: 'PAY_REMAINING_OR_REPLACEMENT' | 'REFUND_DUE_OR_REPLACEMENT' | 'SETTLE_ARREARS_OR_REPLACEMENT' | 'NOTHING_OWED';
  explanation: string;
}

/**
 * - Member already received the pot: they must pay everything still owed
 *   (arrears + late fees + all future contributions) or provide an approved
 *   replacement who takes over those obligations.
 * - Member has not received the pot: they owe arrears + late fees; the fund owes
 *   them their net position minus the early-exit penalty (paid at cycle end), or
 *   a replacement takes over their seat.
 */
export function calculateExitQuote(i: ExitQuoteInput): ExitQuote {
  const remaining = i.arrears + i.futureContributions;
  if (i.hasReceivedPot) {
    const owed = remaining + i.lateFeesOwed;
    return {
      remainingContributions: remaining,
      penalty: 0,
      amountOwedByMember: owed,
      amountOwedToMember: 0,
      requiredAction: owed > 0 ? 'PAY_REMAINING_OR_REPLACEMENT' : 'NOTHING_OWED',
      explanation: owed > 0
        ? 'Member has already received the pot and must pay all remaining contributions and fees, or provide an approved replacement who takes over the remaining obligations.'
        : 'Member has received the pot and has no remaining obligations.',
    };
  }
  const penalty = Math.round((Math.max(0, i.netPosition) * i.earlyExitPenaltyBp) / 10000);
  const owedBy = i.arrears + i.lateFeesOwed;
  const owedTo = Math.max(0, i.netPosition - penalty - owedBy);
  const debit = Math.max(0, owedBy - Math.max(0, i.netPosition - penalty));
  return {
    remainingContributions: remaining,
    penalty,
    amountOwedByMember: debit,
    amountOwedToMember: owedTo,
    requiredAction: debit > 0 ? 'SETTLE_ARREARS_OR_REPLACEMENT' : owedTo > 0 ? 'REFUND_DUE_OR_REPLACEMENT' : 'NOTHING_OWED',
    explanation:
      'Member has not received the pot. Their paid-in balance (less arrears, unpaid fees and the early-exit penalty) is refundable at the end of the cycle, or an approved replacement can take over the seat.',
  };
}

// ---------------------------------------------------------------------------
// 9. Card number guard - never store full card numbers
// ---------------------------------------------------------------------------
export function looksLikeCardNumber(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// 10. Pot recipient obligation & interest calculation with advance return support
// ---------------------------------------------------------------------------

export interface PotObligationParams {
  baseContribution: number; // paisa (e.g. 2000_00 for NPR 2,000)
  initialPotAmount: number; // paisa (e.g. 20000_00 for NPR 20,000)
  cumulativePrincipalRepaid: number; // paisa paid towards principal in regular rounds
  cumulativeAdvanceRepayments: number; // paisa paid as advance principal repayments
  potInterestRateBp: number; // basis points per month (e.g. 100 = 1% per month)
}

export interface PotObligationResult {
  remainingPotPrincipal: number; // paisa
  monthlyInterest: number; // paisa
  principalInstallment: number; // paisa
  totalMonthlyDue: number; // paisa
  explanation: string;
}

/**
 * Calculates the monthly required payment for a member who has taken/received the pot.
 *
 * The pot winner keeps paying the group's normal contribution, and that share is
 * credited against the pot they took. On top of it they pay interest on the pot:
 *
 * - remainingPotPrincipal = max(0, initialPotAmount - cumulativePrincipalRepaid - cumulativeAdvanceRepayments)
 * - monthlyInterest = round(initialPotAmount * potInterestRateBp / 10000), charged on the ORIGINAL pot
 *   and therefore unchanged until the debt is fully cleared
 * - principalInstallment = min(remainingPotPrincipal, baseContribution) — the normal share credited to the pot
 * - totalMonthlyDue = principalInstallment + monthlyInterest
 *
 * Advance repayments reduce remainingPotPrincipal immediately but do not change
 * the interest, which stays on the original pot until the whole thing is paid off.
 */
export function calculatePotRecipientObligation(p: PotObligationParams): PotObligationResult {
  assertInt(p.baseContribution, 'baseContribution');
  assertInt(p.initialPotAmount, 'initialPotAmount');
  assertInt(p.cumulativePrincipalRepaid, 'cumulativePrincipalRepaid');
  assertInt(p.cumulativeAdvanceRepayments, 'cumulativeAdvanceRepayments');
  assertInt(p.potInterestRateBp, 'potInterestRateBp');

  const remainingPotPrincipal = Math.max(
    0,
    p.initialPotAmount - p.cumulativePrincipalRepaid - p.cumulativeAdvanceRepayments
  );

  if (remainingPotPrincipal <= 0) {
    return {
      remainingPotPrincipal: 0,
      monthlyInterest: 0,
      principalInstallment: 0,
      totalMonthlyDue: p.baseContribution,
      explanation: 'Pot amount fully returned. Regular monthly contribution due.',
    };
  }

  const monthlyInterest = Math.round((p.initialPotAmount * Math.max(0, p.potInterestRateBp)) / 10000);
  const principalInstallment = Math.min(remainingPotPrincipal, p.baseContribution);

  const totalMonthlyDue = principalInstallment + monthlyInterest;

  return {
    remainingPotPrincipal,
    monthlyInterest,
    principalInstallment,
    totalMonthlyDue,
    explanation: `Remaining principal: ${remainingPotPrincipal} paisa. Interest on the original pot (${p.potInterestRateBp / 100}%): ${monthlyInterest} paisa. Contribution credited to the pot: ${principalInstallment} paisa. Total monthly due: ${totalMonthlyDue} paisa.`,
  };
}
