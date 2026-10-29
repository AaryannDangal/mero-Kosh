/**
 * Seed: one 5-member bidding dhukuti, replayed through the real services so all
 * balances, audit logs and notifications are genuine.
 *
 *   Rounds 1–2 completed, round 3 collecting (one pending proof, one overdue member).
 *
 * Logins (password for all: Password123!)
 *   organizer@dhukuti.test  Sita Shrestha   (organizer, also a member)
 *   ram@dhukuti.test        राम बहादुर थापा
 *   gita@dhukuti.test       Gita Karki      (co-organizer)
 *   hari@dhukuti.test       Hari Adhikari
 *   maya@dhukuti.test       माया गुरुङ
 *   viewer@dhukuti.test     Auditor Dai     (viewer, read-only)
 *
 * Usage: npm run seed            (skips if seed data exists)
 *        npm run seed -- --reset (wipes ALL data first; refused in production)
 */
import { prisma } from '../src/lib/prisma';
import { setClockOverride } from '../src/lib/clock';
import { hashPassword } from '../src/lib/auth';
import { storage } from '../src/lib/storage';
import * as groups from '../src/services/groups';
import * as rounds from '../src/services/rounds';
import * as ledger from '../src/services/ledger';

const PASSWORD = 'Password123!';
const NPR = (n: number) => Math.round(n * 100);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const at = (iso: string) => setClockOverride(new Date(iso));

async function receipt() {
  return (await storage.save(PNG, 'receipt.png', 'image/png', 'receipts')).key;
}

async function main() {
  const databaseHost = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(databaseHost)) {
    throw new Error('Refusing to seed a non-local database; demo credentials are public');
  }
  const reset = process.argv.includes('--reset');
  if (reset) {
    if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
    const tables = ['notifications', 'audit_logs', 'disputes', 'member_exits', 'ledger_entries', 'bids', 'round_obligations', 'rounds', 'group_members', 'groups', 'users'];
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
    console.log('Database wiped.');
  } else if (await prisma.user.findUnique({ where: { email: 'organizer@dhukuti.test' } })) {
    console.log('Seed data already present - run with --reset to recreate.');
    return;
  }

  at('2026-07-20T04:00:00Z');
  const hash = await hashPassword(PASSWORD);
  const mk = (email: string, fullName: string, phone: string, preferredLanguage = 'en') =>
    prisma.user.create({ data: { email, fullName, phone, passwordHash: hash, preferredLanguage } });
  const uSita = await mk('organizer@dhukuti.test', 'Sita Shrestha', '+9779841000001');
  const uRam = await mk('ram@dhukuti.test', 'राम बहादुर थापा', '+9779841000002', 'ne');
  const uGita = await mk('gita@dhukuti.test', 'Gita Karki', '+9779851000003');
  const uHari = await mk('hari@dhukuti.test', 'Hari Adhikari', '+9779803000004');
  const uMaya = await mk('maya@dhukuti.test', 'माया गुरुङ', '+9779814000005', 'ne');
  await mk('viewer@dhukuti.test', 'Auditor Dai', '+9779860000006');
  const actor = { userId: uSita.id, ip: '127.0.0.1' };

  const group = await groups.createGroup({
    name: 'Kathmandu Saathi Dhukuti',
    description: 'Five friends from Baneshwor saving NPR 10,000 every month. Bidding (बोलकबोल) decides who receives the pot.',
    currency: 'NPR',
    contributionAmount: NPR(10_000),
    memberCount: 5,
    startDate: new Date('2026-08-01T00:00:00Z'),
    frequency: 'MONTHLY',
    collectionDueDay: 10,
    selectionMethod: 'BIDDING',
    lateFeeType: 'FIXED',
    lateFeeValue: NPR(500),
    lateFeeCap: null,
    gracePeriodDays: 3,
    continueAfterPot: true,
    potInterestRateBp: 100,
    minBidDiscount: NPR(1_000),
    bidWinRule: 'HIGHEST_DISCOUNT',
    tieBreakRule: 'EARLIEST',
    missedPaymentRules: 'Two missed payments in a row: the member is marked defaulted and the group meets to decide next steps.',
    earlyExitRules: 'Early exit needs one month notice. A replacement must be approved by all members.',
    earlyExitPenaltyBp: 500,
    joinPassword: 'DemoDhukutiJoin2026!',
  }, { userId: uSita.id, fullName: uSita.fullName, email: uSita.email, phone: uSita.phone, participates: true }, actor);

  const add = (fullName: string, email: string, phone: string, paymentMethod: 'ESEWA' | 'KHALTI' | 'BANK_TRANSFER' | 'CASH', paymentIdentifier: string | null, role: 'MEMBER' | 'CO_ORGANIZER' | 'VIEWER' = 'MEMBER', bankName?: string) =>
    groups.addMember(group, { fullName, email, phone, paymentMethod, paymentIdentifier, role, bankName }, actor);
  const ram = await add('राम बहादुर थापा', 'ram@dhukuti.test', '+9779841000002', 'ESEWA', '9841000002');
  const gita = await add('Gita Karki', 'gita@dhukuti.test', '+9779851000003', 'KHALTI', '9851000003', 'CO_ORGANIZER');
  const hari = await add('Hari Adhikari', 'hari@dhukuti.test', '+9779803000004', 'BANK_TRANSFER', '****4321', 'MEMBER', 'Nabil Bank');
  const maya = await add('माया गुरुङ', 'maya@dhukuti.test', '+9779814000005', 'CASH', null);
  await add('Auditor Dai', 'viewer@dhukuti.test', '+9779860000006', 'CASH', null, 'VIEWER');
  const sita = await prisma.groupMember.findFirstOrThrow({ where: { groupId: group.id, userId: uSita.id } });

  const fresh = await prisma.group.findUniqueOrThrow({ where: { id: group.id } });
  await groups.confirmRules(fresh, actor);
  await rounds.startGroup(group.id, actor);

  const roundNo = (n: number) => prisma.round.findFirstOrThrow({ where: { groupId: group.id, roundNumber: n } });
  const caller = (m: { id: string }) => prisma.groupMember.findUniqueOrThrow({ where: { id: m.id } });
  const userOf: Record<string, string> = { [sita.id]: uSita.id, [ram.id]: uRam.id, [gita.id]: uGita.id, [hari.id]: uHari.id, [maya.id]: uMaya.id };
  const methodOf: Record<string, 'ESEWA' | 'KHALTI' | 'BANK_TRANSFER' | 'CASH'> = { [sita.id]: 'BANK_TRANSFER', [ram.id]: 'ESEWA', [gita.id]: 'KHALTI', [hari.id]: 'BANK_TRANSFER', [maya.id]: 'CASH' };

  const due = async (roundId: string, memberId: string) => {
    const o = await prisma.roundObligation.findUniqueOrThrow({ where: { roundId_memberId: { roundId, memberId } } });
    return o.contributionDue - o.discountCredit;
  };
  /** member uploads proof (pending), organizer verifies unless verify=false */
  const pay = async (roundId: string, m: { id: string }, paidAt: string, verify = true) => {
    at(paidAt);
    const e = await ledger.createEntry(group.id, await caller(m), {
      memberId: m.id, roundId, type: 'CONTRIBUTION', amount: await due(roundId, m.id), method: methodOf[m.id],
      referenceNumber: methodOf[m.id] === 'CASH' ? undefined : `${methodOf[m.id].slice(0, 2)}-${Math.floor(100000 + Math.random() * 899999)}`,
      receiptPath: await receipt(), paidAt: new Date(paidAt),
    }, { userId: userOf[m.id], ip: '127.0.0.1' });
    if (verify) await ledger.verifyEntry(group.id, e.id, false, actor);
    return e;
  };
  const bid = (roundId: string, m: { id: string }, npr: number, when: string) => {
    at(when);
    return rounds.submitBid(group.id, roundId, m.id, NPR(npr), { userId: userOf[m.id], ip: '127.0.0.1' });
  };

  // ---------------- Round 1 (Aug 2026) ----------------
  let r = await roundNo(1);
  await bid(r.id, gita, 4_000, '2026-08-02T05:00:00Z');
  await bid(r.id, hari, 3_000, '2026-08-03T05:00:00Z');
  await bid(r.id, ram, 2_500, '2026-08-04T05:00:00Z');
  at('2026-08-05T05:00:00Z');
  r = await rounds.closeBidding(group.id, r.id, actor);
  for (const m of [sita, ram, gita, hari, maya]) await pay(r.id, m, '2026-08-08T06:00:00Z');
  at('2026-08-11T05:00:00Z');
  await rounds.recordPayout(group.id, r.id, { amount: r.payoutToWinner!, method: 'KHALTI', referenceNumber: 'KH-PAYOUT-0811', receiptPath: await receipt(), paidAt: new Date('2026-08-11T05:00:00Z'), verify: true }, actor);
  await rounds.closeRound(group.id, r.id, { actualClosingBalance: 0 }, actor);

  // ---------------- Round 2 (Sep 2026) ----------------
  r = await roundNo(2);
  await bid(r.id, hari, 3_500, '2026-09-02T05:00:00Z');
  await bid(r.id, maya, 2_000, '2026-09-03T05:00:00Z');
  at('2026-09-05T05:00:00Z');
  r = await rounds.closeBidding(group.id, r.id, actor);
  for (const m of [sita, ram, gita, hari]) await pay(r.id, m, '2026-09-09T06:00:00Z');
  const lateMaya = await pay(r.id, maya, '2026-09-16T06:00:00Z'); // 3 days after grace
  at('2026-09-16T07:00:00Z');
  const fee = await ledger.createEntry(group.id, await caller(maya), {
    memberId: maya.id, roundId: r.id, type: 'LATE_FEE', amount: NPR(500), method: 'CASH', receiptPath: await receipt(), paidAt: new Date('2026-09-16T06:00:00Z'),
  }, { userId: uMaya.id, ip: '127.0.0.1' });
  await ledger.verifyEntry(group.id, fee.id, false, actor);
  // Maya disputes the date recorded; organizer dismisses with explanation
  at('2026-09-17T05:00:00Z');
  const d = await ledger.openDispute(group.id, lateMaya.id, await caller(maya), 'I gave the cash to Sita on the 12th, not the 16th.', { userId: uMaya.id, ip: '127.0.0.1' });
  at('2026-09-18T05:00:00Z');
  await ledger.resolveDispute(group.id, d.id, { outcome: 'DISMISSED', resolution: 'Cash handed over on 16 Sep at the group meeting; confirmed by Gita and Hari.' }, actor);
  at('2026-09-19T05:00:00Z');
  await rounds.recordPayout(group.id, r.id, { amount: r.payoutToWinner!, method: 'BANK_TRANSFER', referenceNumber: 'NABIL-TRF-0919', receiptPath: await receipt(), paidAt: new Date('2026-09-19T05:00:00Z'), verify: true }, actor);
  await rounds.closeRound(group.id, r.id, { actualClosingBalance: NPR(500) }, actor);

  // ---------------- Round 3 (Oct 2026) - still collecting ----------------
  r = await roundNo(3);
  await bid(r.id, ram, 3_000, '2026-10-02T05:00:00Z');
  await bid(r.id, maya, 3_000, '2026-10-03T05:00:00Z');
  at('2026-10-05T05:00:00Z');
  r = await rounds.closeBidding(group.id, r.id, actor);
  for (const m of [sita, gita, hari]) await pay(r.id, m, '2026-10-08T06:00:00Z');
  await pay(r.id, ram, '2026-10-12T06:00:00Z', false); // proof uploaded, awaiting verification
  // Maya has not paid round 3 → overdue after 13 Oct

  setClockOverride(null);
  console.log(`Seeded demo group "${group.name}" (${group.id}).`);
  console.log(`Login: organizer@dhukuti.test / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
