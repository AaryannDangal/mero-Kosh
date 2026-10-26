/**
 * Integration: a missing contribution creates a reconciliation mismatch.
 * Also covers RBAC, the dispute workflow and correction entries.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { api, baseGroup, expectOk, NPR, register, resetDb, Session } from './helpers';

describe('reconciliation with a missing payment', () => {
  let org: Session;
  let member: Session;
  let viewer: Session;
  let groupId: string;
  let ids: string[] = [];
  let round1: { id: string };

  beforeAll(async () => {
    await resetDb();
    org = await register('org@example.com', 'Organizer');
    member = await register('nabin@example.com', 'Nabin');
    viewer = await register('auditor@example.com', 'Auditor');
    const o = api(org);
    const g = expectOk(await o.post('/api/groups', { ...baseGroup, selectionMethod: 'FIXED_ROTATION', startDate: '2026-01-01', lateFeeType: 'NONE', lateFeeValue: 0 }), 201);
    groupId = g.group.id;
    // Nabin is pre-added by email and is linked to his account automatically
    for (const [i, name] of ['Nabin', 'Pooja', 'Rajesh', 'Sunita'].entries()) {
      expectOk(await o.post(`/api/groups/${groupId}/members`, { fullName: name, email: i === 0 ? 'nabin@example.com' : undefined, rotationOrder: i + 2 }), 201);
    }
    expectOk(await o.post(`/api/groups/${groupId}/members`, { fullName: 'Auditor', email: 'auditor@example.com', role: 'VIEWER' }), 201);
    expectOk(await o.post(`/api/groups/${groupId}/confirm-rules`));
    expectOk(await o.post(`/api/groups/${groupId}/start`));
    const members = expectOk(await o.get(`/api/groups/${groupId}/members`)).members
      .filter((m: { isContributor: boolean }) => m.isContributor)
      .sort((a: { rotationOrder: number }, b: { rotationOrder: number }) => a.rotationOrder - b.rotationOrder);
    ids = members.map((m: { id: string }) => m.id);
    round1 = expectOk(await o.get(`/api/groups/${groupId}/rounds`)).rounds[0];
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a missing payment produces a balance mismatch that blocks closing until acknowledged', async () => {
    const o = api(org);
    // 4 of 5 members pay; the last member (Sunita) misses the payment
    for (const id of ids.slice(0, 4)) {
      expectOk(await o.upload(`/api/groups/${groupId}/transactions`, { memberId: id, roundId: round1.id, type: 'CONTRIBUTION', amount: NPR(10_000), method: 'CASH', paidAt: '2026-01-08', verify: true }), 201);
    }
    // the organizer still pays out the full pot to the rotation winner (who has paid)
    expectOk(await o.upload(`/api/groups/${groupId}/rounds/${round1.id}/payout`, { amount: NPR(50_000), method: 'CASH', paidAt: '2026-01-11', verify: true }), 201);

    const preview = expectOk(await o.get(`/api/groups/${groupId}/rounds/${round1.id}/reconciliation?actualClosingBalance=0`));
    expect(preview.flows.contributions).toBe(NPR(40_000));
    expect(preview.collectionShortfall).toBe(NPR(10_000));
    expect(preview.reconciliation.calculatedClosingBalance).toBe(NPR(-10_000));
    expect(preview.reconciliation.status).toBe('MISMATCH');

    // organizer counts the cash box (0) - closing is refused with a reconciliation warning
    const refused = await o.post(`/api/groups/${groupId}/rounds/${round1.id}/close`, { actualClosingBalance: 0 });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/Reconciliation mismatch/);
    expect(refused.body.error.details.reconciliation.difference).toBe(NPR(10_000));
    expect(refused.body.error.details.collectionShortfall).toBe(NPR(10_000));

    // arrears are visible
    const sunita = expectOk(await o.get(`/api/groups/${groupId}/members/${ids[4]}/balance`)).balance;
    expect(sunita.arrears).toBe(NPR(10_000));
    expect(sunita.paymentStatus).toBe('OVERDUE');
    const arrears = expectOk(await o.get(`/api/groups/${groupId}/reports/arrears`));
    expect(arrears.rows).toHaveLength(1);
    expect(arrears.rows[0]).toMatchObject({ member: 'Sunita', arrears: NPR(10_000) });

    // closing with an explicit reason records the mismatch
    const closed = expectOk(await o.post(`/api/groups/${groupId}/rounds/${round1.id}/close`, { actualClosingBalance: 0, mismatchReason: 'Sunita did not pay; organizer advanced NPR 10,000 from own pocket' }));
    expect(closed.round.reconciliationStatus).toBe('MISMATCH');
    expect(closed.round.calculatedClosingBalance).toBe(NPR(-10_000));
    const ack = await prisma.auditLog.findFirst({ where: { groupId, action: 'RECONCILIATION_MISMATCH_ACKNOWLEDGED' } });
    expect(ack?.reason).toMatch(/Sunita/);

    // Σ net positions ≠ 0 → validation error
    const v = expectOk(await o.get(`/api/groups/${groupId}/validation`));
    expect(v.cycleValidation.isZero).toBe(false);
    expect(v.cycleValidation.sumOfNetPositions).toBe(NPR(-10_000));
    expect(v.cycleValidation.error).toMatch(/missing/);

    // reconciliation report carries the warning in CSV
    const csv = await o.get(`/api/groups/${groupId}/reports/reconciliation?format=csv`);
    expect(csv.text).toContain('WARNING');
    expect(csv.text).toContain('Difference / फरक');
  });

  it('a member with arrears cannot be selected as winner, even by override', async () => {
    const o = api(org);
    const r2 = expectOk(await o.get(`/api/groups/${groupId}/rounds`)).rounds[1];
    const res = await o.post(`/api/groups/${groupId}/rounds/${r2.id}/winner-override`, { memberId: ids[4], reason: 'Sunita needs money urgently' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/arrears/);
    // override without a reason is refused by validation
    expect((await o.post(`/api/groups/${groupId}/rounds/${r2.id}/winner-override`, { memberId: ids[2] })).status).toBe(400);
    // override with a reason works and is audited
    expectOk(await o.post(`/api/groups/${groupId}/rounds/${r2.id}/winner-override`, { memberId: ids[2], reason: 'Swap agreed by all members in meeting on 2026-02-01' }));
    const log = await prisma.auditLog.findFirst({ where: { groupId, action: 'MANUAL_OVERRIDE' } });
    expect(log?.reason).toMatch(/Swap agreed/);
  });

  it('enforces role-based access', async () => {
    const m = api(member);
    const v = api(viewer);
    const r2 = expectOk(await m.get(`/api/groups/${groupId}/rounds`)).rounds[1];
    // member cannot record payments for others, verify, or close rounds
    expect((await m.upload(`/api/groups/${groupId}/transactions`, { memberId: ids[2], roundId: r2.id, type: 'CONTRIBUTION', amount: NPR(10_000), method: 'CASH', paidAt: '2026-02-01' })).status).toBe(403);
    expect((await m.post(`/api/groups/${groupId}/rounds/${r2.id}/close`, { actualClosingBalance: 0 })).status).toBe(403);
    // member cannot see others' balances, can see own
    expect((await m.get(`/api/groups/${groupId}/members/${ids[2]}/balance`)).status).toBe(403);
    expectOk(await m.get(`/api/groups/${groupId}/members/${ids[1]}/balance`));
    // viewer: read-only ledger
    expectOk(await v.get(`/api/groups/${groupId}/transactions`));
    expect((await v.upload(`/api/groups/${groupId}/transactions`, { memberId: ids[1], roundId: r2.id, type: 'CONTRIBUTION', amount: NPR(10_000), method: 'CASH', paidAt: '2026-02-01' })).status).toBe(403);
    // outsiders cannot even see that the group exists
    const outsider = await register('outsider@example.com', 'Outsider');
    expect((await api(outsider).get(`/api/groups/${groupId}`)).status).toBe(404);
    // co-organizer cannot delete the group
    const pooja = await register('pooja@example.com', 'Pooja');
    expectOk(await api(org).patch(`/api/groups/${groupId}/members/${ids[2]}`, { email: 'pooja@example.com' }));
    await prisma.groupMember.update({ where: { id: ids[2] }, data: { userId: pooja.userId } });
    expectOk(await api(org).patch(`/api/groups/${groupId}/members/${ids[2]}`, { role: 'CO_ORGANIZER' }));
    expect((await api(pooja).post(`/api/groups/${groupId}/reminders/run`)).status).toBe(200);
    const del = await api(pooja).get(`/api/groups/${groupId}`);
    expect(del.status).toBe(200);
    const delRes = await (await import('supertest')).default((await import('./helpers')).app)
      .delete(`/api/groups/${groupId}`).set({ Authorization: `Bearer ${pooja.token}` }).send({ reason: 'trying' });
    expect(delRes.status).toBe(403);
  });

  it('dispute workflow: member disputes, organizer resolves with a correction entry', async () => {
    const m = api(member);
    const o = api(org);
    const r2open = expectOk(await o.get(`/api/groups/${groupId}/rounds`)).rounds[1];
    // Nabin submits his round-2 payment with a screenshot; the organizer verifies it
    const sub = expectOk(await m.upload(`/api/groups/${groupId}/transactions`, { memberId: ids[1], roundId: r2open.id, type: 'CONTRIBUTION', amount: NPR(10_000), method: 'ESEWA', referenceNumber: 'ES123', paidAt: '2026-02-05' }), 201);
    expectOk(await o.post(`/api/groups/${groupId}/transactions/${sub.entry.id}/verify`));
    const ledger = expectOk(await m.get(`/api/groups/${groupId}/transactions?memberId=${ids[1]}&roundId=${r2open.id}&type=CONTRIBUTION`));
    expect(ledger.entries).toHaveLength(1);
    const entry = ledger.entries[0];
    expect(entry.referenceNumber).toBe('ES123'); // own entry: full details
    // receipts/references of other members are private in the shared ledger
    const all = expectOk(await m.get(`/api/groups/${groupId}/transactions`));
    const others = all.entries.find((e: { memberId: string }) => e.memberId !== ids[1]);
    expect(others.referenceNumber).toBeUndefined();
    expect((await m.get(`/api/groups/${groupId}/transactions/${others.id}/receipt`)).status).toBe(403);

    // verified transactions cannot be rejected/edited - only corrected
    expect((await o.post(`/api/groups/${groupId}/transactions/${entry.id}/reject`, { reason: 'oops' })).status).toBe(409);

    const d = expectOk(await m.post(`/api/groups/${groupId}/transactions/${entry.id}/disputes`, { reason: 'I paid 10,000 but this should be marked for round 1 via eSewa, not cash' }), 201);
    expect((await m.post(`/api/groups/${groupId}/transactions/${entry.id}/disputes`, { reason: 'duplicate dispute' })).status).toBe(409);
    // the round with the open dispute is DISPUTED
    const r2 = expectOk(await o.get(`/api/groups/${groupId}/rounds`)).rounds[1];
    expect(r2.status).toBe('DISPUTED');

    const resolved = expectOk(await o.post(`/api/groups/${groupId}/disputes/${d.dispute.id}/resolve`, { outcome: 'UPHELD', resolution: 'Amount was over-recorded by NPR 1,000', correctionAmount: NPR(-1_000) }));
    expect(resolved.dispute.status).toBe('RESOLVED');
    expect(resolved.dispute.correctionEntryId).toBeTruthy();
    const correction = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: resolved.dispute.correctionEntryId } });
    expect(correction).toMatchObject({ type: 'CORRECTION', amount: NPR(-1_000), correctsEntryId: entry.id, status: 'VERIFIED' });
    const original = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(original.amount).toBe(NPR(10_000)); // original untouched

    const bal = expectOk(await m.get(`/api/groups/${groupId}/me`)).balance;
    expect(bal.totals.contributions).toBe(NPR(19_000)); // round 1 (10,000) + corrected round 2 (9,000)
    expect(bal.rounds.find((r: { roundId: string }) => r.roundId === r2open.id).outstanding).toBe(NPR(1_000));
    const r2b = expectOk(await o.get(`/api/groups/${groupId}/rounds`)).rounds[1];
    expect(r2b.status).not.toBe('DISPUTED');
    const actions = (await prisma.auditLog.findMany({ where: { groupId } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'CORRECTION_RECORDED']));
  });
});
