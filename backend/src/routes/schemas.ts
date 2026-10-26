import { z } from 'zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** multipart/form-data sends strings; accept "true"/"false"/"1"/"0" as booleans */
const boolish = z.preprocess((v) => (v === 'true' || v === '1' || v === 'on' ? true : v === 'false' || v === '0' || v === '' ? false : v), z.boolean());
const paisa = z.coerce.number().int('Amount must be whole paisa').min(0).max(1_000_000_000_00);
const positivePaisa = z.coerce.number().int('Amount must be whole paisa').positive().max(1_000_000_000_00);
const signedPaisa = z.coerce.number().int().refine((n) => n !== 0, 'Amount cannot be zero').refine((n) => Math.abs(n) <= 1_000_000_000_00, 'Amount too large');
const dateOnly = z.coerce.date();
const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => z.preprocess((v) => (v === '' ? undefined : v), trimmed(max).optional().nullable());

// Accept international numbers in E.164 form; legacy local Nepali numbers remain accepted.
const DEV = '०१२३४५६७८९';
export const normalizeDigits = (s: string) => s.replace(/[०-९]/g, (d) => String(DEV.indexOf(d)));
export const phone = z
  .string()
  .trim()
  .transform((s) => normalizeDigits(s))
  .transform((s, ctx) => {
    const parsed = parsePhoneNumberFromString(s, 'NP');
    if (!parsed?.isValid()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid phone number with its country code (for example, +977… or +1…)' });
      return z.NEVER;
    }
    return parsed.number;
  });
const optionalPhone = z.preprocess((v) => (v === '' || v === null ? undefined : v), phone.optional());
const email = z.string().trim().toLowerCase().email().max(200);
const optionalEmail = z.preprocess((v) => (v === '' || v === null ? undefined : v), email.optional());

export const paymentMethod = z.enum(['CASH', 'BANK_TRANSFER', 'ESEWA', 'KHALTI', 'OTHER']);
export const role = z.enum(['ORGANIZER', 'CO_ORGANIZER', 'MEMBER', 'VIEWER']);

// ---------------------------------------------------------------------------
export const registerSchema = z.object({
  email: optionalEmail,
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  fullName: trimmed(120).min(2),
  phone,
  preferredLanguage: z.enum(['en', 'ne']).default('en'),
});
export const loginSchema = z.object({ identifier: trimmed(200).min(1), password: z.string().min(1).max(128) });
export const googleSchema = z.object({ credential: z.string().min(20), phone: optionalPhone });
export const profileSchema = z.object({
  fullName: trimmed(120).min(2).optional(),
  phone: optionalPhone,
  email: z.preprocess((v) => (v === '' ? null : v), email.nullable()).optional(),
  preferredLanguage: z.enum(['en', 'ne']).optional(),
  emailNotificationsEnabled: z.boolean().optional(),
});
export const emailSchema = z.object({ email: email });
export const authTokenSchema = z.object({ token: z.string().min(32).max(200) });
export const passwordResetSchema = authTokenSchema.extend({ password: z.string().min(8).max(128) });
export const deleteAccountSchema = z.object({
  confirmation: z.literal('DELETE'),
  identifier: z.string().trim().min(1).max(200),
  password: z.string().max(128).optional(),
  googleCredential: z.string().min(20).max(10000).optional(),
});

// ---------------------------------------------------------------------------
const groupBase = z.object({
  name: trimmed(120).min(2),
  description: optionalText(2000),
  currency: z.string().trim().toUpperCase().length(3).default('NPR'),
  contributionAmount: positivePaisa,
  memberCount: z.coerce.number().int().min(2).max(100),
  startDate: dateOnly,
  frequency: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  collectionDueDay: z.coerce.number().int().min(0).max(28),
  selectionMethod: z.enum(['FIXED_ROTATION', 'BIDDING', 'ADMIN_SELECTION']),
  lateFeeType: z.enum(['NONE', 'FIXED', 'PERCENTAGE', 'DAILY']).default('NONE'),
  lateFeeValue: paisa.default(0),
  lateFeeCap: z.preprocess((v) => (v === '' ? null : v), paisa.nullable().optional()),
  gracePeriodDays: z.coerce.number().int().min(0).max(60).default(0),
  continueAfterPot: boolish.default(true),
  minBidDiscount: paisa.default(0),
  bidWinRule: z.enum(['HIGHEST_DISCOUNT', 'LOWEST_DISCOUNT']).default('HIGHEST_DISCOUNT'),
  tieBreakRule: z.enum(['EARLIEST', 'RANDOM']).default('EARLIEST'),
  missedPaymentRules: optionalText(4000),
  earlyExitRules: optionalText(4000),
  earlyExitPenaltyBp: z.coerce.number().int().min(0).max(10000).default(0),
});

function groupRefine<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const g = value as Record<string, unknown>;
    if (g.frequency === 'MONTHLY' && g.collectionDueDay !== undefined && ((g.collectionDueDay as number) < 1 || (g.collectionDueDay as number) > 28)) {
      ctx.addIssue({ code: 'custom', path: ['collectionDueDay'], message: 'For monthly groups the due day must be between 1 and 28' });
    }
    if ((g.frequency === 'WEEKLY' || g.frequency === 'BIWEEKLY') && g.collectionDueDay !== undefined && (g.collectionDueDay as number) > 6) {
      ctx.addIssue({ code: 'custom', path: ['collectionDueDay'], message: 'For weekly groups the due day is a weekday 0 (Sunday) – 6 (Saturday)' });
    }
    if (g.lateFeeType === 'PERCENTAGE' && (g.lateFeeValue as number) > 10000) {
      ctx.addIssue({ code: 'custom', path: ['lateFeeValue'], message: 'Percentage late fee is in basis points (max 10000 = 100%)' });
    }
    if (g.lateFeeType && g.lateFeeType !== 'NONE' && !(g.lateFeeValue as number)) {
      ctx.addIssue({ code: 'custom', path: ['lateFeeValue'], message: 'Late fee value is required for the selected late fee type' });
    }
    if (g.contributionAmount && g.memberCount && g.minBidDiscount && (g.minBidDiscount as number) > (g.contributionAmount as number) * ((g.memberCount as number) - 1)) {
      ctx.addIssue({ code: 'custom', path: ['minBidDiscount'], message: 'Minimum bid discount is larger than any distributable discount' });
    }
  });
}

export const createGroupSchema = groupRefine(groupBase.extend({ organizerParticipates: boolish.default(true) }));
export const updateGroupSchema = groupRefine(groupBase.partial());
export const deleteGroupSchema = z.object({ reason: trimmed(500).min(3) });
// ---------------------------------------------------------------------------
export const memberDetailsSchema = z.object({
  fullName: trimmed(120).min(2),
  phone,
  email: optionalEmail,
  paymentMethod: paymentMethod.optional().nullable(),
  paymentIdentifier: optionalText(100),
  bankName: optionalText(100),
});
export const addMemberSchema = memberDetailsSchema.extend({
  role: role.default('MEMBER'),
  rotationOrder: z.coerce.number().int().min(1).max(100).optional().nullable(),
});
export const updateMemberSchema = memberDetailsSchema.partial().extend({
  role: role.optional(),
  rotationOrder: z.coerce.number().int().min(1).max(100).optional().nullable(),
});
export const memberStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'WAITING', 'SUSPENDED', 'DEFAULTED']),
  reason: trimmed(500).min(3),
});
export const reasonSchema = z.object({ reason: trimmed(1000).min(3, 'A reason is required') });
export const exitSchema = z.object({
  settlement: z.enum(['PAY_REMAINING', 'REPLACEMENT', 'REFUND_AT_CYCLE_END']),
  reason: trimmed(1000).min(3),
  replacement: memberDetailsSchema.optional(),
});

// ---------------------------------------------------------------------------
export const bidSchema = z.object({ discountAmount: paisa });
export const overrideSchema = z.object({
  memberId: z.string().min(1),
  reason: trimmed(1000).min(5, 'A detailed reason is required for a manual override'),
  bidDiscount: paisa.optional(),
});
export const payoutSchema = z.object({
  amount: positivePaisa,
  method: paymentMethod,
  referenceNumber: optionalText(100),
  proofUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().max(500).optional()),
  paidAt: z.coerce.date(),
  notes: optionalText(1000),
  verify: boolish.default(false),
});
export const closeRoundSchema = z.object({
  actualClosingBalance: z.coerce.number().int(),
  mismatchReason: optionalText(1000),
});

// ---------------------------------------------------------------------------
export const entryTypes = z.enum(['CONTRIBUTION', 'POT_PAYOUT', 'BID_DISCOUNT', 'LATE_FEE', 'PENALTY', 'REFUND', 'CORRECTION', 'MANUAL_ADJUSTMENT']);
export const createEntrySchema = z.object({
  memberId: z.string().min(1),
  roundId: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional().nullable()),
  type: entryTypes,
  amount: z.coerce.number().int().refine((n) => n !== 0, 'Amount cannot be zero'),
  method: paymentMethod,
  referenceNumber: optionalText(100),
  proofUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().max(500).optional()),
  paidAt: z.coerce.date(),
  notes: optionalText(1000),
  verify: boolish.default(false),
  cashReceivedInPerson: boolish.default(false),
});
export const verifyEntrySchema = z.object({ cashReceivedInPerson: boolish.default(false) });
export const proofSchema = z.object({ proofUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().max(500).optional()) });
export const correctionSchema = z.object({ amount: signedPaisa, reason: trimmed(1000).min(5) });
export const listEntriesQuery = z.object({
  memberId: z.string().optional(),
  roundId: z.string().optional(),
  type: entryTypes.optional(),
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
export const disputeSchema = z.object({ reason: trimmed(2000).min(5) });
export const resolveDisputeSchema = z.object({
  outcome: z.enum(['UPHELD', 'DISMISSED']),
  resolution: trimmed(2000).min(5),
  correctionAmount: signedPaisa.optional(),
});
export const reportFormat = z.object({ format: z.enum(['json', 'csv', 'pdf']).default('json') });
export const auditQuery = z.object({
  action: z.string().optional(),
  entityType: z.string().optional(),
  userId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
