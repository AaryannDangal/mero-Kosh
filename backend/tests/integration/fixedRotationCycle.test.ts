/**
 * Integration: a complete 5-member FIXED ROTATION cycle through the HTTP API
 * against a real PostgreSQL database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { api, baseGroup, expectOk, NPR, register, resetDb, Session } from './helpers';

describe('5-member fixed-rotation cycle', () => {
  let org: Session;
  let groupId: string;
  const memberIds: string[] = [];

  beforeAll(async () => {
    await resetDb();
    org = await register('organizer@example.com', 'Sita Sharma');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates the group, adds members (incl. Nepali names) and confirms bilingual rules', async () => {
    const o = api(org);
    const created = expectOk(await o.post('/api/groups', { ...baseGroup, selectionMethod: 'FIXED_ROTATION', startDate: '2026-01-01' }), 201);
    groupId = created.group.id;
    expect(created.group.joinCode).toMatch(/^DK-/);
    expect(created.rules.en.length).toBeGreaterThan(5);
    expect(created.rules.ne.length).toBe(created.rules.en.length);

    const people = [
      { fullName: 'राम बहादुर थापा', phone: '९८४११११११११'.slice(0, 10), email: 'ram@example.com', paymentMethod: 'ESEWA', paymentIdentifier: '9841111111' },
      { fullName: 'Gita Karki', phone: '9851222222', paymentMethod: 'KHALTI', paymentIdentifier: '9851222222' },
      { fullName: 'Hari Prasad Adhikari', phone: '+9779803333333', paymentMethod: 'BANK_TRANSFER', paymentIdentifier: '****4321', bankName: 'Nabil Bank' },
      { fullName: 'माया गुरुङ', phone: '9814444444', paymentMethod: 'CASH' },
    ];
    // full card numbers are refused
    const bad = await o.post(`/api/groups/${groupId}/members`, { fullName: 'Card Person', phone: '9851000001', paymentMethod: 'OTHER', paymentIdentifier: '4111 1111 1111 1111' });
    expect(bad.status).toBe(422);

    for (const p of people) {
      const r = expectOk(await o.post(`/api/groups/${groupId}/members`, p), 201);
      expect(r.member.fullName).toBe(p.fullName);
    }
    // 6th seat is refused
    expect((await o.post(`/api/groups/${groupId}/members`, { fullName: 'Extra Person', phone: '9851000002' })).status).toBe(409);

    const members = expectOk(await o.get(`/api/groups/${groupId}/members`)).members;
    expect(members).toHaveLength(5);
    expect(members.find((m: { fullName: string }) => m.fullName === 'राम बहादुर थापा').phone).toBe('+9779841111111'); // Devanagari digits normalised to E.164

    // cannot start before confirming rules
    expect((await o.post(`/api/groups/${groupId}/start`)).status).toBe(422);
    expectOk(await o.post(`/api/groups/${groupId}/confirm-rules`));
    const started = expectOk(await o.post(`/api/groups/${groupId}/start`));
    expect(started.group.status).toBe('ACTIVE');

    const after = expectOk(await o.get(`/api/groups/${groupId}/members`)).members;
    after.sort((a: { rotationOrder: number }, b: { rotationOrder: number }) => a.rotationOrder - b.rotationOrder);
    expect(after.map((m: { rotationOrder: number }) => m.rotationOrder)).toEqual([1, 2, 3, 4, 5]);
    memberIds.push(...after.map((m: { id: string }) => m.id));
  });

  it('runs all 5 rounds: contributions with proof → verification → payout → reconciliation', async () => {
    const o = api(org);
    for (let r = 1; r <= 5; r++) {
      const rounds = expectOk(await o.get(`/api/groups/${groupId}/rounds`)).rounds;
      expect(rounds).toHaveLength(5);
      const round = rounds.find((x: { roundNumber: number }) => x.roundNumber === r);
      expect(round.status).toBe('COLLECTING');
      expect(round.fullPot).toBe(NPR(50_000));
      expect(round.winnerMemberId).toBe(memberIds[r - 1]); // fixed rotation order
      const paidAt = new Date(Date.UTC(2026, r - 1, 5)).toISOString();

      // verification without proof is refused
      const noProof = expectOk(await o.post(`/api/groups/${groupId}/transactions`, {
        memberId: memberIds[0], roundId: round.id, type: 'CONTRIBUTION', amount: NPR(10_000), method: 'CASH', paidAt,
      }), 201);
      expect(noProof.entry.status).toBe('PENDING');
      expect((await o.post(`/api/groups/${groupId}/transactions/${noProof.entry.id}/verify`)).status).toBe(422);
      expectOk(await o.upload(`/api/groups/${groupId}/transactions/${noProof.entry.id}/proof`, {}));
      expectOk(await o.post(`/api/groups/${groupId}/transactions/${noProof.entry.id}/verify`));

      // payout is blocked while the recipient (or anyone) has not paid? -> only recipient matters
      for (let i = 1; i < 5; i++) {
        const res = expectOk(await o.upload(`/api/groups/${groupId}/transactions`, {
          memberId: memberIds[i], roundId: round.id, type: 'CONTRIBUTION', amount: NPR(10_000),
          method: i % 2 ? 'ESEWA' : 'BANK_TRANSFER', referenceNumber: `REF-${r}-${i}`, paidAt, verify: true,
        }), 201);
        expect(res.entry.status).toBe('VERIFIED');
      }
      // overpayment is refused (the last member never holds the pot, so no pot allowance applies)
      const over = await o.upload(`/api/groups/${groupId}/transactions`, { memberId: memberIds[4], roundId: round.id, type: 'CONTRIBUTION', amount: 1, method: 'CASH', paidAt });
      expect(over.status).toBe(422);

      const detail = expectOk(await o.get(`/api/groups/${groupId}/rounds/${round.id}`));
      expect(detail.round.status).toBe('PAYOUT_PENDING');
      expect(detail.checklist.every((c: { status: string }) => c.status === 'PAID')).toBe(true);

      // wrong payout amount is refused
      const wrong = await o.upload(`/api/groups/${groupId}/rounds/${round.id}/payout`, { amount: NPR(49_000), method: 'BANK_TRANSFER', paidAt, verify: true });
      expect(wrong.status).toBe(422);
      const payout = expectOk(await o.upload(`/api/groups/${groupId}/rounds/${round.id}/payout`, {
        amount: NPR(50_000), method: 'BANK_TRANSFER', referenceNumber: `PAYOUT-${r}`, paidAt, verify: true,
      }), 201);
      expect(payout.entry.status).toBe('VERIFIED');
      expect(payout.entry.memberId).toBe(memberIds[r - 1]);

      const closed = expectOk(await o.post(`/api/groups/${groupId}/rounds/${round.id}/close`, { actualClosingBalance: 0 }));
      expect(closed.reconciliation.status).toBe('BALANCED');
      expect(closed.reconciliation.calculatedClosingBalance).toBe(0);
      expect(closed.round.status).toBe('COMPLETED');
      expect(closed.round.actualCollection).toBe(NPR(50_000));
    }
  });

  it('ends with every net position at zero and Σ net = 0, then completes the group', async () => {
    const o = api(org);
    const v = expectOk(await o.get(`/api/groups/${groupId}/validation`));
    expect(v.status).toBe('SETTLEMENT');
    expect(v.allRoundsClosed).toBe(true);
    expect(v.cycleValidation).toMatchObject({ isZero: true, sumOfNetPositions: 0 });
    for (const n of v.netPositions) expect(n.net).toBe(0);

    for (const id of memberIds) {
      const b = expectOk(await o.get(`/api/groups/${groupId}/members/${id}/balance`)).balance;
      expect(b.totals.contributions).toBe(NPR(50_000));
      expect(b.totals.potReceived).toBe(NPR(50_000));
      expect(b.arrears).toBe(0);
      expect(b.potStatus).toBe('COMPLETED');
      expect(b.remainingContributions).toBe(0);
    }
    const done = expectOk(await o.post(`/api/groups/${groupId}/complete`));
    expect(done.group.status).toBe('COMPLETED');
  });

  it('verified entries are immutable at the database level and every action is audited', async () => {
    const verified = await prisma.ledgerEntry.findFirstOrThrow({ where: { groupId, status: 'VERIFIED' } });
    await expect(prisma.ledgerEntry.update({ where: { id: verified.id }, data: { amount: 1 } })).rejects.toThrow(/immutable/);
    await expect(prisma.ledgerEntry.delete({ where: { id: verified.id } })).rejects.toThrow(/cannot be deleted/);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { groupId } });
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: 'X' } })).rejects.toThrow(/append-only/);

    const audit = expectOk(await api(org).get(`/api/groups/${groupId}/audit?pageSize=500`));
    const actions = new Set(audit.logs.map((l: { action: string }) => l.action));
    for (const a of ['GROUP_CREATED', 'MEMBER_ADDED', 'GROUP_RULES_CONFIRMED', 'GROUP_STARTED', 'ROUND_OPENED', 'PAYMENT_RECORDED', 'PAYMENT_VERIFIED', 'PROOF_ATTACHED', 'PAYOUT_RECORDED', 'ROUND_CLOSED', 'GROUP_COMPLETED']) {
      expect(actions.has(a), `audit action ${a}`).toBe(true);
    }
    const sample = audit.logs.find((l: { action: string }) => l.action === 'PAYMENT_VERIFIED');
    expect(sample).toMatchObject({ userId: org.userId, entityType: 'LedgerEntry' });
    expect(sample.createdAt).toBeTruthy();
    expect(sample.oldValue).toEqual({ status: 'PENDING' });
  });

  it('exports cycle report as CSV (bilingual headers) and PDF', async () => {
    const o = api(org);
    const csv = await o.get(`/api/groups/${groupId}/reports/cycle?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Round / चरण');
    expect(csv.text).toContain('Recipient / प्राप्तकर्ता');
    const pdf = await o.get(`/api/groups/${groupId}/reports/cycle?format=pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
