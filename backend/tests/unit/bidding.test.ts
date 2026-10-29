import { describe, expect, it } from 'vitest';
import { bidLimits, calculateBidDistribution, selectBidWinner, validateBidAmount } from '../../src/domain/calculations';

describe('calculateBidDistribution', () => {
  it('payout = full pot − discount, discount split among waiting members', () => {
    const d = calculateBidDistribution(5_000_000, 500_000, ['a', 'b', 'c', 'd']);
    expect(d.payoutToWinner).toBe(4_500_000);
    expect(d.sharePerMember).toBe(125_000);
    expect(d.shares).toEqual([
      { memberId: 'a', amount: 125_000 },
      { memberId: 'b', amount: 125_000 },
      { memberId: 'c', amount: 125_000 },
      { memberId: 'd', amount: 125_000 },
    ]);
  });

  it('distributes remainder paisa so shares always sum exactly to the discount', () => {
    const d = calculateBidDistribution(5_000_000, 400_000, ['a', 'b', 'c']);
    expect(d.shares.map((s) => s.amount)).toEqual([133_334, 133_333, 133_333]);
    expect(d.shares.reduce((a, s) => a + s.amount, 0)).toBe(400_000);
    expect(d.sharePerMember).toBe(133_333);
  });

  it('handles odd paisa across many members', () => {
    const ids = Array.from({ length: 7 }, (_, i) => `m${i}`);
    const d = calculateBidDistribution(10_000_000, 1_000_001, ids);
    expect(d.shares.reduce((a, s) => a + s.amount, 0)).toBe(1_000_001);
    expect(Math.max(...d.shares.map((s) => s.amount)) - Math.min(...d.shares.map((s) => s.amount))).toBeLessThanOrEqual(1);
  });

  it('allows zero discount and zero recipients (last round)', () => {
    const d = calculateBidDistribution(5_000_000, 0, []);
    expect(d.payoutToWinner).toBe(5_000_000);
    expect(d.shares).toEqual([]);
  });

  it('rejects a discount without recipients, negative or above the pot', () => {
    expect(() => calculateBidDistribution(5_000_000, 100, [])).toThrow();
    expect(() => calculateBidDistribution(5_000_000, -1, ['a'])).toThrow();
    expect(() => calculateBidDistribution(5_000_000, 5_000_001, ['a'])).toThrow();
  });
});

describe('bid limits & validation', () => {
  it('max discount is the lower of the full pot and what recipients owe', () => {
    expect(bidLimits({ fullPot: 5_000_000, minBidDiscount: 100_000, recipientContributionTotal: 4_000_000 })).toEqual({ minDiscount: 100_000, maxDiscount: 4_000_000 });
    expect(bidLimits({ fullPot: 1_000, minBidDiscount: 0, recipientContributionTotal: 9_000 }).maxDiscount).toBe(1_000);
  });

  it('prevents bids below the minimum and above the maximum', () => {
    const limits = { minDiscount: 100_000, maxDiscount: 4_000_000 };
    expect(validateBidAmount(99_999, limits).ok).toBe(false);
    expect(validateBidAmount(4_000_001, limits).ok).toBe(false);
    expect(validateBidAmount(100_000, limits).ok).toBe(true);
    expect(validateBidAmount(4_000_000, limits).ok).toBe(true);
    expect(validateBidAmount(1.5, limits).ok).toBe(false);
  });
});

describe('selectBidWinner', () => {
  const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));
  const bids = [
    { memberId: 'a', discountAmount: 300_000, submittedAt: t(1) },
    { memberId: 'b', discountAmount: 500_000, submittedAt: t(5) },
    { memberId: 'c', discountAmount: 500_000, submittedAt: t(2) },
    { memberId: 'd', discountAmount: 100_000, submittedAt: t(9) },
    { memberId: 'e', discountAmount: 100_000, submittedAt: t(3) },
  ];

  it('HIGHEST_DISCOUNT: biggest discount wins, tie → earliest submission', () => {
    const r = selectBidWinner(bids, 'HIGHEST_DISCOUNT', 'EARLIEST');
    expect(r.winner.memberId).toBe('c');
    expect(r.tiedMemberIds).toEqual(['c', 'b']);
    expect(r.tieBroken).toBe(true);
  });

  it('LOWEST_DISCOUNT: lowest bid wins, tie → earliest submission', () => {
    const r = selectBidWinner(bids, 'LOWEST_DISCOUNT', 'EARLIEST');
    expect(r.winner.memberId).toBe('e');
  });

  it('RANDOM tie-break uses the injected RNG', () => {
    expect(selectBidWinner(bids, 'HIGHEST_DISCOUNT', 'RANDOM', () => 0).winner.memberId).toBe('c');
    expect(selectBidWinner(bids, 'HIGHEST_DISCOUNT', 'RANDOM', () => 0.99).winner.memberId).toBe('b');
  });

  it('no tie → no tie-break', () => {
    const r = selectBidWinner(bids.slice(0, 2), 'HIGHEST_DISCOUNT', 'RANDOM', () => 0.99);
    expect(r.winner.memberId).toBe('b');
    expect(r.tieBroken).toBe(false);
  });

  it('throws on empty bids', () => {
    expect(() => selectBidWinner([], 'HIGHEST_DISCOUNT', 'EARLIEST')).toThrow();
  });
});
