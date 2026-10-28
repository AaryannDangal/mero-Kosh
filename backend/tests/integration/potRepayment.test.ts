/**
 * Integration: the pot-winner repayment program.
 *
 * The member who takes the pot keeps paying the group's normal contribution and that
 * share is credited against the pot they took. On top of it they pay interest on the
 * ORIGINAL pot, which does not change until the whole pot is repaid. They may pay a
 * lump sum at any time to clear the debt faster.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { api, baseGroup, expectOk, NPR, register, resetDb, Session } from './helpers';

const CONTRIBUTION = NPR(2_000); // everyone pays NPR 2,000 a month
const POT = NPR(10_000); // 5 members x NPR 2,000
const INTEREST = NPR(100); // 1% per month on the original pot
const paidAt = new Date(Date.UTC(2026, 0, 5)).toISOString();

describe('pot winner repays the pot', () => {
  let org: Session;
  let groupId: string;
  let memberIds: string[] = [];

  beforeAll(async () => {
    await resetDb();
    org = await register('organizer@example.com', 'Sita Sharma');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('runs a round so one member takes the pot', async () => {
    const o = api(org);
    const created = expectOk(await o.post('/api/groups', {
      ...baseGroup,
      selectionMethod: 'FIXED_ROTATION',
      startDate: '2026-01-01',
      contributionAmount: CONTRIBUTION,
      lateFeeValue: NPR(100),
    }), 201);
    groupId = created.group.id;

    for (const p of [
      { fullName: 'Ram', phone: '9841111111', paymentMethod: 'ESEWA', paymentIdentifier: '9841111111' },
      { fullName: 'Gita', phone: '9851222222', paymentMethod: 'KHALTI', paymentIdentifier: '9851222222' },
      { fullName: 'Hari', phone: '9803333333', paymentMethod: 'BANK_TRANSFER', paymentIdentifier: '****4321', bankName: 'Nabil Bank' },
      { fullName: 'Maya', phone: '9814444444', paymentMethod: 'CASH' },
    ]) expectOk(await o.post(`/api/groups/${groupId}/members`, p), 201);

    expectOk(await o.post(`/api/groups/${groupId}/confirm-rules`));
    expectOk(await o.post(`/api/groups/${groupId}/start`));

    const members = expectOk(await o.get(`/api/groups/${groupId}/members`)).members;
    members.sort((a: { rotationOrder: number }, b: { rotationOrder: number }) => a.rotationOrder - b.rotationOrder);
    memberIds = members.map((m: { id: string }) => m.id);

    const rounds = expectOk(await o.get(`/api/groups/${groupId}/rounds`)).rounds;
    const round1 = rounds.find((r: { roundNumber: number }) => r.roundNumber === 1);
    expect(round1.fullPot).toBe(POT);
    expect(round1.winnerMemberId).toBe(memberIds[0]); // fixed rotation: the organizer takes it

    for (const id of memberIds) {
      expectOk(await o.upload(`/api/groups/${groupId}/transactions`, {
        memberId: id, roundId: round1.id, type: 'CONTRIBUTION', amount: CONTRIBUTION, method: 'CASH', paidAt, verify: true,
      }), 201);
    }
    expectOk(await o.upload(`/api/groups/${groupId}/rounds/${round1.id}/payout`, {
      amount: POT, method: 'BANK_TRANSFER', referenceNumber: 'PAYOUT-1', paidAt, verify: true,
    }), 201);
    expectOk(await o.post(`/api/groups/${groupId}/rounds/${round1.id}/close`, { actualClosingBalance: 0 }));
  });

  it('shows the winner their pot debt', async () => {
    const o = api(org);
    const winner = memberIds[0];
    const balance = expectOk(await o.get(`/api/groups/${groupId}/members/${winner}/balance`)).balance;

    expect(balance.hasReceivedPot).toBe(true);
    expect(balance.potObligation).toMatchObject({
      initialPotAmount: POT,
      remainingPotPrincipal: POT,
      monthlyInterest: INTEREST,
      principalInstallment: CONTRIBUTION,
      totalMonthlyDue: CONTRIBUTION + INTEREST,
    });

    // the winner sees it on their own dashboard too (advisory, nothing is blocked)
    const me = expectOk(await o.get(`/api/groups/${groupId}/me`)).balance;
    expect(me.potObligation.remainingPotPrincipal).toBe(POT);
    expect(me.potObligation.monthlyInterest).toBe(INTEREST);

    // nobody else has a pot debt
    const other = expectOk(await o.get(`/api/groups/${groupId}/members/${memberIds[1]}/balance`)).balance;
    expect(other.potObligation).toBeFalsy();
  });

  it('accepts the monthly contribution plus pot interest, and keeps the interest fixed', async () => {
    const o = api(org);
    const winner = memberIds[0];
    const rounds = expectOk(await o.get(`/api/groups/${groupId}/rounds`)).rounds;
    const round2 = rounds.find((r: { roundNumber: number }) => r.roundNumber === 2);

    // the winner pays their contribution (NPR 2,000) plus the pot interest (NPR 100)
    const res = await o.upload(`/api/groups/${groupId}/transactions`, {
      memberId: winner, roundId: round2.id, type: 'CONTRIBUTION', amount: CONTRIBUTION + INTEREST,
      method: 'CASH', paidAt, notes: 'Regular monthly payment + pot interest', verify: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.entry.status).toBe('VERIFIED');

    const balance = expectOk(await o.get(`/api/groups/${groupId}/members/${winner}/balance`)).balance;
    // the contribution was credited against the pot
    expect(balance.potObligation.remainingPotPrincipal).toBe(POT - CONTRIBUTION);
    expect(balance.potObligation.cumulativePrincipalRepaid).toBe(CONTRIBUTION);
    // interest is charged on the ORIGINAL pot, so it does not shrink with the balance
    expect(balance.potObligation.monthlyInterest).toBe(INTEREST);
    expect(balance.potObligation.totalMonthlyDue).toBe(CONTRIBUTION + INTEREST);
  });

  it('lets the winner clear the debt faster with a lump sum, interest unchanged', async () => {
    const o = api(org);
    const winner = memberIds[0];
    const rounds = expectOk(await o.get(`/api/groups/${groupId}/rounds`)).rounds;
    const round2 = rounds.find((r: { roundNumber: number }) => r.roundNumber === 2);

    const lump = expectOk(await o.upload(`/api/groups/${groupId}/transactions`, {
      memberId: winner, roundId: round2.id, type: 'CONTRIBUTION', amount: NPR(5_000),
      method: 'CASH', paidAt, notes: 'ADVANCE_POT_REPAYMENT', verify: true,
    }), 201);
    expect(lump.entry.status).toBe('VERIFIED');

    const balance = expectOk(await o.get(`/api/groups/${groupId}/members/${winner}/balance`)).balance;
    expect(balance.potObligation.cumulativeAdvanceRepayments).toBe(NPR(5_000));
    expect(balance.potObligation.remainingPotPrincipal).toBe(POT - CONTRIBUTION - NPR(5_000));
    // the interest stays the same until the whole pot is paid off
    expect(balance.potObligation.monthlyInterest).toBe(INTEREST);

    // more than what is still owed is refused
    const tooMuch = await o.upload(`/api/groups/${groupId}/transactions`, {
      memberId: winner, roundId: round2.id, type: 'CONTRIBUTION', amount: NPR(50_000),
      method: 'CASH', paidAt, notes: 'ADVANCE_POT_REPAYMENT', verify: true,
    });
    expect(tooMuch.status).toBe(422);
  });

  it('still refuses overpayment from members who do not owe a pot', async () => {
    const o = api(org);
    const rounds = expectOk(await o.get(`/api/groups/${groupId}/rounds`)).rounds;
    const round2 = rounds.find((r: { roundNumber: number }) => r.roundNumber === 2);

    const over = await o.upload(`/api/groups/${groupId}/transactions`, {
      memberId: memberIds[1], roundId: round2.id, type: 'CONTRIBUTION', amount: CONTRIBUTION + NPR(1),
      method: 'CASH', paidAt,
    });
    expect(over.status).toBe(422);
  });
});
