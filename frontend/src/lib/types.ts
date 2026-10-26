export type Role = 'ORGANIZER' | 'CO_ORGANIZER' | 'MEMBER' | 'VIEWER';
export type GroupStatus = 'DRAFT' | 'ACTIVE' | 'SETTLEMENT' | 'COMPLETED';
export type EntryType = 'CONTRIBUTION' | 'POT_PAYOUT' | 'BID_DISCOUNT' | 'LATE_FEE' | 'PENALTY' | 'REFUND' | 'CORRECTION' | 'MANUAL_ADJUSTMENT';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'ESEWA' | 'KHALTI' | 'OTHER';
export const ENTRY_TYPES: EntryType[] = ['CONTRIBUTION', 'POT_PAYOUT', 'BID_DISCOUNT', 'LATE_FEE', 'PENALTY', 'REFUND', 'CORRECTION', 'MANUAL_ADJUSTMENT'];
export const METHODS: PaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'ESEWA', 'KHALTI', 'OTHER'];

export interface User { id: string; email: string | null; fullName: string; phone: string | null; preferredLanguage: 'en' | 'ne'; emailVerified: boolean; emailNotificationsEnabled: boolean; hasGoogle: boolean; hasPassword: boolean }

export interface Group {
  id: string; name: string; description: string | null; currency: string; contributionAmount: number; memberCount: number;
  startDate: string; frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'; collectionDueDay: number; selectionMethod: 'FIXED_ROTATION' | 'ADMIN_SELECTION' | 'BIDDING';
  lateFeeType: 'NONE' | 'FIXED' | 'PERCENTAGE' | 'DAILY'; lateFeeValue: number; lateFeeCap: number | null; gracePeriodDays: number;
  continueAfterPot: boolean; minBidDiscount: number; bidWinRule: 'HIGHEST_DISCOUNT' | 'LOWEST_DISCOUNT'; tieBreakRule: 'EARLIEST' | 'RANDOM';
  missedPaymentRules: string | null; earlyExitRules: string | null; earlyExitPenaltyBp: number;
  status: GroupStatus; rulesConfirmedAt: string | null; createdAt: string;
}

export interface Member {
  id: string; fullName: string; role: Role; status: string; isContributor: boolean; rotationOrder: number | null; hasReceivedPot: boolean;
  joinedAt: string; hasPhoto: boolean; linkedAccount: boolean; exitedAt: string | null;
  phone?: string | null; email?: string | null; paymentMethod?: PaymentMethod | null; paymentIdentifier?: string | null; bankName?: string | null;
  paymentStatus?: string; potStatus?: string; netPosition?: number; arrears?: number; lateFeeOutstanding?: number;
}

export interface Entry {
  id: string; seq: number; roundId: string | null; ledgerRoundId: string | null; memberId: string; memberName?: string; type: EntryType;
  amount: number; method: PaymentMethod; paidAt: string; status: 'PENDING' | 'VERIFIED' | 'REJECTED'; verifiedAt: string | null;
  correctsEntryId: string | null; createdAt: string; hasReceipt: boolean; cashReceivedInPerson?: boolean; referenceNumber?: string | null; proofUrl?: string | null;
  notes?: string | null; rejectedReason?: string | null;
}

export interface MemberRoundState {
  roundId: string; roundNumber: number; dueDate: string; contributionDue: number; discountCredit: number; amountDue: number; paid: number;
  pending: number; outstanding: number; status: string; lateFeeAssessed: number; lateFeePaid: number; lateFeeOutstanding: number; daysLate: number;
}

export interface Balance {
  memberId: string; fullName: string; status: string; hasReceivedPot: boolean;
  totals: { contributions: number; discountCredits: number; lateFeesPaid: number; penaltiesPaid: number; potReceived: number; refundsReceived: number; adjustments: number; netPosition: number };
  totalDiscountCredits: number; rounds: MemberRoundState[]; arrears: number; overdueAmount: number; lateFeeAssessed: number; lateFeePaid: number;
  lateFeeOutstanding: number; remainingContributions: number; pendingAmount: number;
  nextDue: { roundId: string; roundNumber: number; dueDate: string; amountDue: number; outstanding: number } | null;
  paymentStatus: string; potStatus: string;
}

export interface Round {
  id: string; roundNumber: number; periodLabel: string; dueDate: string; status: string; biddingStatus: string; selectionMethod: string;
  contributorCount: number | null; fullPot: number | null; winnerMemberId: string | null; winnerName: string | null; plannedRecipient?: string | null;
  bidDiscount: number; payoutToWinner: number | null; discountRecipientCount: number; discountSharePerMember: number;
  expectedCollection: number | null; actualCollection: number | null; totalLateFees: number | null; openingBalance: number;
  calculatedClosingBalance: number | null; actualClosingBalance: number | null; reconciliationStatus: string; reconciliationNote: string | null;
  selectionOverrideReason: string | null; payoutEntryId: string | null; collectedForRound?: number; closedAt: string | null;
}

export interface Reconciliation {
  flows: { contributions: number; lateFees: number; penalties: number; payouts: number; refunds: number; adjustments: number; byMethod: Record<string, { in: number; out: number }> };
  reconciliation: { calculatedClosingBalance: number; actualClosingBalance: number | null; difference: number | null; status: string; warning: string | null };
  expectedCollection: number | null; collectionShortfall: number;
}

export interface CycleValidation { sumOfNetPositions: number; isZero: boolean; error: string | null }

export const isManagerRole = (r?: Role) => r === 'ORGANIZER' || r === 'CO_ORGANIZER';
