import { describe, expect, it } from 'vitest';
import { calculateExitQuote, generateSchedule, looksLikeCardNumber, winnerIneligibilityReason } from '../../src/domain/calculations';
import { distributeEvenly, formatNpr } from '../../src/domain/money';
import { buildRules, toNepaliDigits } from '../../src/domain/rules';

describe('schedule', () => {
  it('monthly: due on the configured day, moving to next month if before the start', () => {
    const s = generateSchedule(new Date('2026-01-15T00:00:00Z'), 'MONTHLY', 10, 3);
    expect(s.map((r) => r.dueDate.toISOString().slice(0, 10))).toEqual(['2026-02-10', '2026-03-10', '2026-04-10']);
    expect(s[0].periodEnd.toISOString().slice(0, 10)).toBe('2026-02-14');
  });
  it('weekly: due on the configured weekday', () => {
    const s = generateSchedule(new Date('2026-01-01T00:00:00Z'), 'WEEKLY', 6, 3); // Saturday
    expect(s.map((r) => r.dueDate.toISOString().slice(0, 10))).toEqual(['2026-01-03', '2026-01-10', '2026-01-17']);
    expect(s.every((r) => r.dueDate.getUTCDay() === 6)).toBe(true);
  });
  it('biweekly periods are 14 days', () => {
    const s = generateSchedule(new Date('2026-01-01T00:00:00Z'), 'BIWEEKLY', 4, 2);
    expect((s[1].periodStart.getTime() - s[0].periodStart.getTime()) / 86400000).toBe(14);
  });
});

describe('winner eligibility', () => {
  const ok = { status: 'WAITING' as const, isContributor: true, hasReceivedPot: false, arrears: 0, currentRoundUnpaid: 0 };
  it('blocks arrears, repeat winners, suspended and unpaid current round', () => {
    expect(winnerIneligibilityReason(ok, true)).toBeNull();
    expect(winnerIneligibilityReason({ ...ok, arrears: 1 }, false)).toMatch(/arrears/);
    expect(winnerIneligibilityReason({ ...ok, hasReceivedPot: true }, false)).toMatch(/already/);
    expect(winnerIneligibilityReason({ ...ok, status: 'SUSPENDED' }, false)).toMatch(/suspended/);
    expect(winnerIneligibilityReason({ ...ok, currentRoundUnpaid: 5 }, true)).toMatch(/current round/);
    expect(winnerIneligibilityReason({ ...ok, currentRoundUnpaid: 5 }, false)).toBeNull();
  });
});

describe('early exit quote', () => {
  it('member who received the pot owes all remaining contributions', () => {
    const q = calculateExitQuote({ hasReceivedPot: true, contributionsPaid: 2_000_000, potReceived: 5_000_000, arrears: 0, lateFeesOwed: 0, futureContributions: 3_000_000, earlyExitPenaltyBp: 0, netPosition: -3_000_000 });
    expect(q.amountOwedByMember).toBe(3_000_000);
    expect(q.requiredAction).toBe('PAY_REMAINING_OR_REPLACEMENT');
  });
  it('member who has not received gets a refund minus penalty and arrears', () => {
    const q = calculateExitQuote({ hasReceivedPot: false, contributionsPaid: 2_000_000, potReceived: 0, arrears: 0, lateFeesOwed: 50_000, futureContributions: 0, earlyExitPenaltyBp: 1000, netPosition: 2_000_000 });
    expect(q.penalty).toBe(200_000);
    expect(q.amountOwedToMember).toBe(2_000_000 - 200_000 - 50_000);
    expect(q.requiredAction).toBe('REFUND_DUE_OR_REPLACEMENT');
  });
});

describe('money & security helpers', () => {
  it('formats NPR with Nepali digit grouping', () => {
    expect(formatNpr(1_234_567_850)).toBe('NPR 1,23,45,678.50');
    expect(formatNpr(-50_000)).toBe('-NPR 500');
  });
  it('distributeEvenly is exact', () => {
    expect(distributeEvenly(10, 3)).toEqual([4, 3, 3]);
    expect(distributeEvenly(-10, 3)).toEqual([-4, -3, -3]);
  });
  it('detects full card numbers (Luhn) but allows wallet IDs / masked accounts', () => {
    expect(looksLikeCardNumber('4111 1111 1111 1111')).toBe(true);
    expect(looksLikeCardNumber('9841234567')).toBe(false);
    expect(looksLikeCardNumber('****1234')).toBe(false);
  });
  it('rules are produced in English and Nepali', () => {
    const r = buildRules({
      name: 'Test', currency: 'NPR', contributionAmount: 1_000_000, memberCount: 5, startDate: new Date('2026-01-01'), frequency: 'MONTHLY',
      collectionDueDay: 10, selectionMethod: 'BIDDING', lateFeeType: 'FIXED', lateFeeValue: 50_000, lateFeeCap: null, gracePeriodDays: 3,
      continueAfterPot: true, minBidDiscount: 100_000, bidWinRule: 'HIGHEST_DISCOUNT', tieBreakRule: 'EARLIEST', missedPaymentRules: null,
      earlyExitRules: null, earlyExitPenaltyBp: 0,
    });
    expect(r.en.length).toBe(r.ne.length);
    expect(r.ne.join(' ')).toContain('बोलकबोल');
    expect(toNepaliDigits('2026')).toBe('२०२६');
  });
});
