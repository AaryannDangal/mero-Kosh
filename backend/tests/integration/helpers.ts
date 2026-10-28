import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';

export const app: Express = createApp();

/** 1×1 transparent PNG used as a payment receipt screenshot. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

export async function resetDb() {
  const tables = ['notifications', 'audit_logs', 'disputes', 'member_exits', 'ledger_entries', 'bids', 'round_obligations', 'rounds', 'group_members', 'groups', 'users'];
  // TRUNCATE bypasses the row-level immutability triggers (tests only)
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export interface Session {
  token: string;
  userId: string;
  email: string;
}

/**
 * `users.phone` is unique, so every registration needs its own number.
 * The old hard-coded 9841000000 made the 2nd register in a file fail with 409.
 */
let phoneSeq = 0;
export function testPhone(): string {
  phoneSeq += 1;
  return `98${String(10000000 + phoneSeq)}`;
}

export async function register(email: string, fullName: string, password = 'password123'): Promise<Session> {
  const res = await request(app).post('/api/auth/register').send({ email, password, fullName, phone: testPhone() });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, userId: res.body.user.id, email };
}

export const auth = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

export function api(s: Session) {
  const h = auth(s);
  return {
    get: (url: string) => request(app).get(url).set(h),
    post: (url: string, body?: object) => request(app).post(url).set(h).send(body ?? {}),
    put: (url: string, body?: object) => request(app).put(url).set(h).send(body ?? {}),
    patch: (url: string, body?: object) => request(app).patch(url).set(h).send(body ?? {}),
    /** multipart with a receipt screenshot */
    upload: (url: string, fields: Record<string, string | number | boolean>, field = 'receipt') => {
      let r = request(app).post(url).set(h).attach(field, PNG, { filename: 'receipt.png', contentType: 'image/png' });
      for (const [k, v] of Object.entries(fields)) r = r.field(k, String(v));
      return r;
    },
  };
}

export function expectOk(res: request.Response, status = 200) {
  if (res.status !== status) {
    throw new Error(`Expected HTTP ${status} but got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export const NPR = (n: number) => Math.round(n * 100);

export const baseGroup = {
  name: 'Kathmandu Saathi Dhukuti',
  description: 'Test group',
  currency: 'NPR',
  contributionAmount: NPR(10_000),
  memberCount: 5,
  frequency: 'MONTHLY',
  collectionDueDay: 10,
  lateFeeType: 'FIXED',
  lateFeeValue: NPR(500),
  gracePeriodDays: 2,
  continueAfterPot: true,
  minBidDiscount: NPR(1_000),
  bidWinRule: 'HIGHEST_DISCOUNT',
  tieBreakRule: 'EARLIEST',
  organizerParticipates: true,
};
