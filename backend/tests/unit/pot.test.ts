import { describe, expect, it } from 'vitest';
import { calculateFullPot, selectContributors, ContributorCandidate } from '../../src/domain/calculations';

const m = (id: string, over: Partial<ContributorCandidate> = {}): ContributorCandidate => ({
  id, status: 'WAITING', isContributor: true, hasReceivedPot: false, exitSettlement: null, ...over,
});

describe('calculateFullPot', () => {
  it('is contribution × active members', () => {
    expect(calculateFullPot(1_000_000, 5)).toBe(5_000_000); // NPR 10,000 × 5 = NPR 50,000
    expect(calculateFullPot(250_050, 12)).toBe(3_000_600);
  });

  it('is zero with no active members', () => {
    expect(calculateFullPot(1_000_000, 0)).toBe(0);
  });

  it('rejects invalid input', () => {
    expect(() => calculateFullPot(0, 5)).toThrow();
    expect(() => calculateFullPot(-100, 5)).toThrow();
    expect(() => calculateFullPot(100.5, 5)).toThrow(); // must be whole paisa
    expect(() => calculateFullPot(100, -1)).toThrow();
    expect(() => calculateFullPot(100, 2.5)).toThrow();
  });
});

describe('selectContributors (who counts as an active member for the pot)', () => {
  const members = [
    m('a'),
    m('b', { hasReceivedPot: true, status: 'RECEIVED_POT' }),
    m('c', { status: 'SUSPENDED' }),
    m('d', { status: 'EXITED' }),
    m('e', { isContributor: false }),
    m('f', { status: 'EXITED', hasReceivedPot: true, exitSettlement: 'PAY_REMAINING' }),
    m('g', { status: 'DEFAULTED' }),
  ];

  it('includes received-pot, suspended and defaulted members when they must keep contributing', () => {
    const ids = selectContributors(members, true).map((x) => x.id);
    expect(ids).toEqual(['a', 'b', 'c', 'f', 'g']);
    expect(calculateFullPot(1_000_000, ids.length)).toBe(5_000_000);
  });

  it('excludes members who already received the pot when they stop contributing', () => {
    const ids = selectContributors(members, false).map((x) => x.id);
    expect(ids).toEqual(['a', 'c', 'g']);
  });

  it('never includes viewers / non-playing organizers or plainly exited members', () => {
    const ids = selectContributors(members, true).map((x) => x.id);
    expect(ids).not.toContain('d');
    expect(ids).not.toContain('e');
  });
});
