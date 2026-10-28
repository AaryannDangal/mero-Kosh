/**
 * Integration: a complete 5-member BIDDING cycle through the HTTP API with a
 * controlled clock - sealed bids, tie-break, discount shares, a late payment
 * with late fee, end-of-cycle settlement and the zero-sum validation.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { api, baseGroup, expectOk, NPR, register, resetDb, Session } from './helpers';

const at = (iso: string) => vi.setSystemTime(new Date(iso));

describe('5-member bidding cycle', () => {
  let A: Session; // organizer, also a member
  let B: Session; let C: Session; let D: Session; let E: Session;
  const mid: Record<string, string> = {};
  let groupId: string;

  const roundByNo = async (n: number) => {
    const rounds = expectOk(await api(A).get(`/api/groups/${groupId}/rounds`)).rounds;
    return rounds.find((r: { roundNumber: number }) => r.roundNumber === n);
  };

  /** members submit their own proof; organizer verifies */
  const payAll = async (roundId: string, paidAt: string, skip: string[] = []) => {
    const detail = expectOk(await api(A).get(`/api/groups/${groupId}/rounds/${roundId}`));
    for (const [key, s] of Object.entries({ A, B, C, D, E })) {
      if (skip.includes(key)) continue;
      const row = detail.checklist.find((c: { memberId: string }) => c.memberId === mid[key]);
      const submitted = expectOk(await api(s).upload(`/api/groups/${groupId}/transactions`, {
        memberId: mid[key], roundId, type: 'CONTRIBUTION', amount: row.amountDue, method: 'ESEWA', referenceNumber: `ES-${key}-${roundId.slice(-4)}`, paidAt,
      }), 201);
      expect(submitted.entry.status).toBe('PENDING');
      expectOk(await api(A).post(`/api/groups/${groupId}/transactions/${submitted.entry.id}/verify`));
    }
  };

  const payoutAndClose = async (roundId: string, amount: number, paidAt: string, actual: number) => {
    expectOk(await api(A).upload(`/api/groups/${groupId}/rounds/${roundId}/payout`, { amount, method: 'BANK_TRANSFER', referenceNumber: 'NIC-ASIA-1', paidAt, verify: true }), 201);
    return expectOk(await api(A).post(`/api/groups/${groupId}/rounds/${roundId}/close`, { actualClosingBalance: actual }));
  };

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-01-01T06:00:00Z');
    await resetDb();
    A = await register('a@example.com', 'Anita (Organizer)');
    B = await register('b@example.com', 'Bikash');
    C = await register('c@example.com', 'Chandra');
    D = await register('d@example.com', 'Deepa');
    E = await register('e@example.com', 'Eknath');
  });
  afterAll(async () => {
    vi.useRealTimers();
    await prisma.$disconnect();
  });

  it('sets up the group with join-code joins and starts it', async () => {
    const joinPassword = 'DemoDhukutiJoin2026!';
    const g = expectOk(await api(A).post('/api/groups', { ...baseGroup, selectionMethod: 'BIDDING', startDate: '2026-01-05', joinPassword }), 201);
    groupId = g.group.id;
    for (const s of [B, C, D, E]) {
      expectOk(await api(s).post('/api/groups/join', { code: g.group.joinCode, password: joinPassword }), 201);
    }
    // the organizer approves every join request
    const requests = expectOk(await api(A).get(`/api/groups/${groupId}/join-requests`)).requests;
    expect(requests).toHaveLength(4);
    for (const r of requests) expectOk(await api(A).post(`/api/groups/${groupId}/join-requests/${r.id}/approve`));

    // members do not see the join code or each other's private details
    const asB = expectOk(await api(B).get(`/api/groups/${groupId}`));
    expect(asB.group.joinCode).toBeUndefined();
    const membersAsB = expectOk(await api(B).get(`/api/groups/${groupId}/members`)).members;
    expect(membersAsB.find((m: { fullName: string }) => m.fullName === 'Chandra').phone).toBeUndefined();

    expectOk(await api(A).post(`/api/groups/${groupId}/confirm-rules`));
    expectOk(await api(A).post(`/api/groups/${groupId}/start`));
    const members = expectOk(await api(A).get(`/api/groups/${groupId}/members`)).members;
    for (const [k, name] of Object.entries({ A: 'Anita (Organizer)', B: 'Bikash', C: 'Chandra', D: 'Deepa', E: 'Eknath' })) {
      mid[k] = members.find((m: { fullName: string }) => m.fullName === name).id;
    }
    const r1 = await roundByNo(1);
    expect(r1.dueDate.slice(0, 10)).toBe('2026-01-10');
    expect(r1.biddingStatus).toBe('OPEN');
  });

  it('round 1: sealed bids, limits, tie → earliest, discount shared by the 4 waiting members', async () => {
    const r1 = await roundByNo(1);
    const url = `/api/groups/${groupId}/rounds/${r1.id}/bids/me`;
    expect((await api(B).put(url, { discountAmount: NPR(500) })).status).toBe(422); // below minimum
    expect((await api(B).put(url, { discountAmount: NPR(50_001) })).status).toBe(422); // above the pot
    expectOk(await api(B).put(url, { discountAmount: NPR(2_000) }));
    expectOk(await api(B).put(url, { discountAmount: NPR(3_000) })); // change bid (audited)
    at('2026-01-02T06:00:00Z');
    expectOk(await api(C).put(url, { discountAmount: NPR(5_000) }));
    at('2026-01-03T06:00:00Z');
    expectOk(await api(D).put(url, { discountAmount: NPR(5_000) })); // same amount, later

    // sealed: B sees only own amount; the organizer sees who bid but not amounts
    const asB = expectOk(await api(B).get(`/api/groups/${groupId}/rounds/${r1.id}`));
    expect(asB.bids.revealed).toBe(false);
    expect(asB.bids.items).toHaveLength(1);
    expect(asB.bids.myBid.discountAmount).toBe(NPR(3_000));
    const asA = expectOk(await api(A).get(`/api/groups/${groupId}/rounds/${r1.id}`));
    expect(asA.bids.count).toBe(3);
    expect(asA.bids.items.every((b: { discountAmount: number | null }) => b.discountAmount === null)).toBe(true);
    // payout cannot be recorded while bidding is open
    expect((await api(A).upload(`/api/groups/${groupId}/rounds/${r1.id}/payout`, { amount: NPR(50_000), method: 'CASH', paidAt: '2026-01-03', verify: true })).status).toBe(422);

    const closed = expectOk(await api(A).post(`/api/groups/${groupId}/rounds/${r1.id}/bids/close`));
    expect(closed.round.winnerMemberId).toBe(mid.C); // tie with D broken by earliest submission
    expect(closed.round.bidDiscount).toBe(NPR(5_000));
    expect(closed.round.payoutToWinner).toBe(NPR(45_000));
    expect(closed.round.discountRecipientCount).toBe(4);
    expect(closed.round.discountSharePerMember).toBe(NPR(1_250));

    const revealed = expectOk(await api(E).get(`/api/groups/${groupId}/rounds/${r1.id}`));
    expect(revealed.bids.revealed).toBe(true);
    expect(revealed.bids.items.map((b: { discountAmount: number }) => b.discountAmount).sort()).toEqual([NPR(3_000), NPR(5_000), NPR(5_000)].sort());
    const dues = Object.fromEntries(revealed.checklist.map((c: { memberId: string; amountDue: number }) => [c.memberId, c.amountDue]));
    expect(dues[mid.C]).toBe(NPR(10_000));
    for (const k of ['A', 'B', 'D', 'E']) expect(dues[mid[k]]).toBe(NPR(8_750));

    at('2026-01-08T06:00:00Z');
    await payAll(r1.id, '2026-01-08');
    const res = await payoutAndClose(r1.id, NPR(45_000), '2026-01-09', 0);
    expect(res.reconciliation).toMatchObject({ status: 'BALANCED', calculatedClosingBalance: 0 });
    expect(res.flows.contributions).toBe(NPR(45_000));
  });

  it('round 2: a member who already won cannot bid; late payment incurs a late fee', async () => {
    at('2026-02-01T06:00:00Z');
    const r2 = await roundByNo(2);
    const url = `/api/groups/${groupId}/rounds/${r2.id}/bids/me`;
    expect((await api(C).put(url, { discountAmount: NPR(2_000) })).status).toBe(422); // already received
    expectOk(await api(A).put(url, { discountAmount: NPR(2_000) }));
    expectOk(await api(B).put(url, { discountAmount: NPR(4_000) }));
    const closed = expectOk(await api(A).post(`/api/groups/${groupId}/rounds/${r2.id}/bids/close`));
    expect(closed.round.winnerMemberId).toBe(mid.B);
    expect(closed.round.discountRecipientCount).toBe(3); // A, D, E
    expect(closed.round.payoutToWinner).toBe(NPR(46_000));

    // remainder paisa: 4000 / 3 → 1333.34 + 1333.33 + 1333.33
    const detail = expectOk(await api(A).get(`/api/groups/${groupId}/rounds/${r2.id}`));
    const credits = detail.checklist.map((c: { discountCredit: number }) => c.discountCredit).filter((x: number) => x > 0).sort();
    expect(credits).toEqual([133_333, 133_333, 133_334]);

    at('2026-02-08T06:00:00Z');
    await payAll(r2.id, '2026-02-08', ['D']); // D pays late
    at('2026-02-15T06:00:00Z'); // due 10th + 2 grace days → overdue
    const dBal = expectOk(await api(D).get(`/api/groups/${groupId}/me`)).balance;
    expect(dBal.paymentStatus).toBe('OVERDUE');
    expect(dBal.arrears).toBeGreaterThan(0);
    expect(dBal.lateFeeOutstanding).toBe(NPR(500));
    const dash = expectOk(await api(A).get(`/api/groups/${groupId}/dashboard`));
    expect(dash.overdueMembers.map((m: { memberId: string }) => m.memberId)).toContain(mid.D);

    // reminders: overdue notification created once (idempotent)
    const rem1 = expectOk(await api(A).post(`/api/groups/${groupId}/reminders/run`));
    expect(rem1.overdue).toBe(1);
    const rem2 = expectOk(await api(A).post(`/api/groups/${groupId}/reminders/run`));
    expect(rem2.overdue).toBe(0);

    await payAll(r2.id, '2026-02-15', ['A', 'B', 'C', 'E']);
    // the late fee
    expect((await api(D).upload(`/api/groups/${groupId}/transactions`, { memberId: mid.D, roundId: r2.id, type: 'LATE_FEE', amount: NPR(600), method: 'CASH', paidAt: '2026-02-15' })).status).toBe(422);
    const fee = expectOk(await api(D).upload(`/api/groups/${groupId}/transactions`, { memberId: mid.D, roundId: r2.id, type: 'LATE_FEE', amount: NPR(500), method: 'CASH', paidAt: '2026-02-15' }), 201);
    expectOk(await api(A).post(`/api/groups/${groupId}/transactions/${fee.entry.id}/verify`));
    const dAfter = expectOk(await api(D).get(`/api/groups/${groupId}/me`)).balance;
    expect(dAfter.lateFeeOutstanding).toBe(0);
    expect(dAfter.totals.lateFeesPaid).toBe(NPR(500));

    // closing balance must now include the late fee
    const mismatch = await api(A).upload(`/api/groups/${groupId}/rounds/${r2.id}/payout`, { amount: NPR(46_000), method: 'BANK_TRANSFER', paidAt: '2026-02-16', verify: true });
    expect(mismatch.status).toBe(201);
    expect((await api(A).post(`/api/groups/${groupId}/rounds/${r2.id}/close`, { actualClosingBalance: 0 })).status).toBe(409);
    const ok = expectOk(await api(A).post(`/api/groups/${groupId}/rounds/${r2.id}/close`, { actualClosingBalance: NPR(500) }));
    expect(ok.reconciliation.status).toBe('BALANCED');
  });

  it('rounds 3–4: tie-break and minimum bid; round 5 is auto-assigned to the last member', async () => {
    at('2026-03-01T06:00:00Z');
    const r3 = await roundByNo(3);
    expect(r3.openingBalance).toBe(NPR(500));
    const url3 = `/api/groups/${groupId}/rounds/${r3.id}/bids/me`;
    expectOk(await api(D).put(url3, { discountAmount: NPR(1_500) }));
    at('2026-03-02T06:00:00Z');
    expectOk(await api(A).put(url3, { discountAmount: NPR(1_500) }));
    const c3 = expectOk(await api(A).post(`/api/groups/${groupId}/rounds/${r3.id}/bids/close`));
    expect(c3.round.winnerMemberId).toBe(mid.D);
    expect(c3.round.discountSharePerMember).toBe(NPR(750));
    at('2026-03-05T06:00:00Z');
    await payAll(r3.id, '2026-03-05');
    await payoutAndClose(r3.id, NPR(48_500), '2026-03-06', NPR(500));

    at('2026-04-01T06:00:00Z');
    const r4 = await roundByNo(4);
    expectOk(await api(E).put(`/api/groups/${groupId}/rounds/${r4.id}/bids/me`, { discountAmount: NPR(1_000) }));
    const c4 = expectOk(await api(A).post(`/api/groups/${groupId}/rounds/${r4.id}/bids/close`));
    expect(c4.round.winnerMemberId).toBe(mid.E);
    expect(c4.round.discountRecipientCount).toBe(1);
    at('2026-04-05T06:00:00Z');
    await payAll(r4.id, '2026-04-05');
    await payoutAndClose(r4.id, NPR(49_000), '2026-04-06', NPR(500));

    at('2026-05-01T06:00:00Z');
    const r5 = await roundByNo(5);
    expect(r5.winnerMemberId).toBe(mid.A);
    expect(r5.biddingStatus).toBe('CLOSED');
    expect(r5.payoutToWinner).toBe(NPR(50_000));
    expect((await api(A).put(`/api/groups/${groupId}/rounds/${r5.id}/bids/me`, { discountAmount: NPR(1_000) })).status).toBe(409);
    at('2026-05-05T06:00:00Z');
    await payAll(r5.id, '2026-05-05');
    await payoutAndClose(r5.id, NPR(50_000), '2026-05-06', NPR(500));
  });

  it('settlement distributes the late fee, then Σ net positions = 0', async () => {
    at('2026-05-07T06:00:00Z');
    const before = expectOk(await api(A).get(`/api/groups/${groupId}/validation`));
    expect(before.status).toBe('SETTLEMENT');
    expect(before.cycleValidation.isZero).toBe(false);
    expect(before.cycleValidation.sumOfNetPositions).toBe(NPR(500));
    expect((await api(A).post(`/api/groups/${groupId}/complete`)).status).toBe(422);

    const preview = expectOk(await api(A).get(`/api/groups/${groupId}/settlement/preview`));
    expect(preview.distributable).toBe(NPR(500));
    expect(preview.shares.map((s: { amount: number }) => s.amount)).toEqual([NPR(100), NPR(100), NPR(100), NPR(100), NPR(100)]);
    const created = expectOk(await api(A).post(`/api/groups/${groupId}/settlement`), 201);
    for (const e of created.entries) {
      expectOk(await api(A).upload(`/api/groups/${groupId}/transactions/${e.id}/proof`, {}));
      expectOk(await api(A).post(`/api/groups/${groupId}/transactions/${e.id}/verify`));
    }

    const v = expectOk(await api(A).get(`/api/groups/${groupId}/validation`));
    expect(v.cycleValidation).toMatchObject({ isZero: true, sumOfNetPositions: 0 });
    const net = Object.fromEntries(v.netPositions.map((n: { memberId: string; net: number }) => [n.memberId, n.net]));
    // C won round 1: paid 50,000, received 45,000 + 100 refund
    expect(net[mid.C]).toBe(NPR(4_900));
    // A won last: discounts received make A's net negative (A gained)
    expect(net[mid.A]).toBeLessThan(0);

    const cBal = expectOk(await api(C).get(`/api/groups/${groupId}/me`)).balance;
    expect(cBal.totals.contributions).toBe(NPR(50_000));
    expect(cBal.totals.potReceived).toBe(NPR(45_000));
    expect(cBal.totalDiscountCredits).toBe(0);
    const aBal = expectOk(await api(A).get(`/api/groups/${groupId}/me`)).balance;
    expect(aBal.totalDiscountCredits).toBe(NPR(1_250) + 133_334 + NPR(750) + NPR(1_000));
    expect(aBal.totals.discountCredits).toBe(aBal.totalDiscountCredits); // materialised as BID_DISCOUNT entries at close

    expect(expectOk(await api(A).post(`/api/groups/${groupId}/complete`)).group.status).toBe('COMPLETED');

    // notifications were produced for winners and verifications
    const notes = expectOk(await api(C).get('/api/notifications'));
    expect(notes.notifications.some((n: { type: string }) => n.type === 'WINNER_SELECTED')).toBe(true);
    expect(notes.notifications.some((n: { type: string }) => n.type === 'PAYMENT_VERIFIED')).toBe(true);
    expect(notes.notifications.some((n: { type: string }) => n.type === 'PAYOUT_RECORDED')).toBe(true);
  });
});
