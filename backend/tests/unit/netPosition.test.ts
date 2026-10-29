import { describe, expect, it } from 'vitest';
import {
  calculateBidDistribution,
  computeMemberTotals,
  LedgerEntryLike,
  netPosition,
  reconcileRound,
  validateCycleZeroSum,
} from '../../src/domain/calculations';

const v = (type: LedgerEntryLike['type'], amount: number, extra: Partial<LedgerEntryLike> = {}): LedgerEntryLike => ({ type, amount, status: 'VERIFIED', ...extra });

describe('computeMemberTotals / net position', () => {
  it('net = contributions + late fees + penalties + adjustments − pot received − refunds', () => {
    const t = computeMemberTotals([
      v('CONTRIBUTION', 1_000_000),
      v('CONTRIBUTION', 875_000),
      v('BID_DISCOUNT', 125_000),
      v('LATE_FEE', 50_000),
      v('PENALTY', 20_000),
      v('POT_PAYOUT', 4_500_000),
      v('REFUND', 10_000),
    ]);
    expect(t.contributions).toBe(1_875_000);
    expect(t.discountCredits).toBe(125_000);
    expect(t.lateFeesPaid).toBe(50_000);
    expect(t.penaltiesPaid).toBe(20_000);
    expect(t.potReceived).toBe(4_500_000);
    expect(t.refundsReceived).toBe(10_000);
    expect(t.netPosition).toBe(1_875_000 + 50_000 + 20_000 - 4_500_000 - 10_000);
    expect(t.netPosition).toBe(t.cashIn - t.cashOut);
  });

  it('ignores pending and rejected entries', () => {
    const t = computeMemberTotals([v('CONTRIBUTION', 100), { type: 'CONTRIBUTION', amount: 999, status: 'PENDING' }, { type: 'POT_PAYOUT', amount: 5_000, status: 'REJECTED' }]);
    expect(t.netPosition).toBe(100);
  });

  it('corrections inherit the type of the corrected entry', () => {
    const t = computeMemberTotals([
      v('CONTRIBUTION', 1_000_000),
      v('CORRECTION', -100_000, { correctsType: 'CONTRIBUTION' }),
      v('POT_PAYOUT', 5_000_000),
      v('CORRECTION', -50_000, { correctsType: 'POT_PAYOUT' }),
    ]);
    expect(t.contributions).toBe(900_000);
    expect(t.potReceived).toBe(4_950_000);
    expect(t.netPosition).toBe(900_000 - 4_950_000);
  });

  it('signed manual adjustments', () => {
    expect(computeMemberTotals([v('MANUAL_ADJUSTMENT', -2_000)]).netPosition).toBe(-2_000);
    expect(netPosition({ contributions: 10, lateFeesPaid: 1, penaltiesPaid: 1, adjustments: 3, potReceived: 5, refundsReceived: 2 })).toBe(8);
  });
});

describe('validateCycleZeroSum', () => {
  it('passes when Σ net = 0', () => {
    expect(validateCycleZeroSum([500_000, -125_000, -375_000])).toMatchObject({ isZero: true, error: null });
  });
  it('fails with an explanation otherwise', () => {
    const r = validateCycleZeroSum([500_000, -125_000]);
    expect(r.isZero).toBe(false);
    expect(r.sumOfNetPositions).toBe(375_000);
    expect(r.error).toMatch(/expected 0/);
    expect(validateCycleZeroSum([-1_000_000]).error).toMatch(/missing/);
  });
});

describe('pure simulation of a full 5-member bidding cycle is zero-sum', () => {
  it('Σ net positions = 0 and the winner of round 1 pays the "interest"', () => {
    const C = 1_000_000;
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const winners = ['c', 'b', 'd', 'e', 'a'];
    const discounts = [500_000, 400_000, 150_000, 100_000, 0];
    const ledger: Record<string, LedgerEntryLike[]> = Object.fromEntries(ids.map((i) => [i, []]));
    const received = new Set<string>();
    winners.forEach((w, r) => {
      const fullPot = C * ids.length;
      const recipients = ids.filter((i) => !received.has(i) && i !== w);
      const dist = calculateBidDistribution(fullPot, discounts[r], recipients);
      for (const i of ids) {
        const credit = dist.shares.find((s) => s.memberId === i)?.amount ?? 0;
        ledger[i].push(v('CONTRIBUTION', C - credit));
        if (credit) ledger[i].push(v('BID_DISCOUNT', credit));
      }
      ledger[w].push(v('POT_PAYOUT', dist.payoutToWinner));
      received.add(w);
    });
    const nets = ids.map((i) => computeMemberTotals(ledger[i]).netPosition);
    expect(validateCycleZeroSum(nets).isZero).toBe(true);
    expect(nets[ids.indexOf('c')]).toBe(500_000); // first winner: paid 50,000, received 45,000
    expect(nets[ids.indexOf('a')]).toBeLessThan(0); // last winner earned the discounts
  });
});

describe('reconcileRound', () => {
  it('opening + contributions + late fees − payout = closing', () => {
    const r = reconcileRound({ openingBalance: 0, totalContributions: 5_000_000, lateFees: 50_000, payoutToWinner: 5_000_000, actualClosingBalance: 50_000 });
    expect(r).toMatchObject({ calculatedClosingBalance: 50_000, status: 'BALANCED', difference: 0, warning: null });
  });

  it('flags a mismatch with a warning', () => {
    const r = reconcileRound({ openingBalance: 0, totalContributions: 4_000_000, lateFees: 0, payoutToWinner: 5_000_000, actualClosingBalance: 0 });
    expect(r.calculatedClosingBalance).toBe(-1_000_000);
    expect(r.status).toBe('MISMATCH');
    expect(r.difference).toBe(1_000_000);
    expect(r.warning).toMatch(/mismatch/i);
  });

  it('NOT_STARTED when no actual balance entered', () => {
    expect(reconcileRound({ openingBalance: 10, totalContributions: 0, lateFees: 0, payoutToWinner: 0 }).status).toBe('NOT_STARTED');
  });
});
