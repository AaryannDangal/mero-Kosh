-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('ORGANIZER', 'CO_ORGANIZER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'WAITING', 'RECEIVED_POT', 'EXITED', 'SUSPENDED', 'DEFAULTED');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "SelectionMethod" AS ENUM ('FIXED_ROTATION', 'BIDDING');

-- CreateEnum
CREATE TYPE "LateFeeType" AS ENUM ('NONE', 'FIXED', 'PERCENTAGE', 'DAILY');

-- CreateEnum
CREATE TYPE "BidWinRule" AS ENUM ('HIGHEST_DISCOUNT', 'LOWEST_DISCOUNT');

-- CreateEnum
CREATE TYPE "TieBreakRule" AS ENUM ('EARLIEST', 'RANDOM');

-- CreateEnum
CREATE TYPE "GroupStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SETTLEMENT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('UPCOMING', 'COLLECTING', 'PAYOUT_PENDING', 'COMPLETED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "BiddingStatus" AS ENUM ('NOT_APPLICABLE', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('NOT_STARTED', 'BALANCED', 'MISMATCH');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('CONTRIBUTION', 'POT_PAYOUT', 'BID_DISCOUNT', 'LATE_FEE', 'PENALTY', 'REFUND', 'CORRECTION', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'ESEWA', 'KHALTI', 'OTHER');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('UPHELD', 'DISMISSED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'WINNER_SELECTED', 'PAYOUT_RECORDED', 'PAYMENT_VERIFIED', 'PAYMENT_REJECTED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'GENERAL');

-- CreateEnum
CREATE TYPE "ExitSettlement" AS ENUM ('PAY_REMAINING', 'REPLACEMENT', 'REFUND_AT_CYCLE_END');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "googleId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NPR',
    "contributionAmount" INTEGER NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "collectionDueDay" INTEGER NOT NULL,
    "selectionMethod" "SelectionMethod" NOT NULL,
    "lateFeeType" "LateFeeType" NOT NULL DEFAULT 'NONE',
    "lateFeeValue" INTEGER NOT NULL DEFAULT 0,
    "lateFeeCap" INTEGER,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "continueAfterPot" BOOLEAN NOT NULL DEFAULT true,
    "minBidDiscount" INTEGER NOT NULL DEFAULT 0,
    "bidWinRule" "BidWinRule" NOT NULL DEFAULT 'HIGHEST_DISCOUNT',
    "tieBreakRule" "TieBreakRule" NOT NULL DEFAULT 'EARLIEST',
    "missedPaymentRules" TEXT,
    "earlyExitRules" TEXT,
    "earlyExitPenaltyBp" INTEGER NOT NULL DEFAULT 0,
    "inviteCode" TEXT NOT NULL,
    "status" "GroupStatus" NOT NULL DEFAULT 'DRAFT',
    "rulesConfirmedAt" TIMESTAMP(3),
    "rulesConfirmedById" TEXT,
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "paymentMethod" "PaymentMethod",
    "paymentIdentifier" TEXT,
    "bankName" TEXT,
    "profilePhotoPath" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "GroupRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "isContributor" BOOLEAN NOT NULL DEFAULT true,
    "rotationOrder" INTEGER,
    "hasReceivedPot" BOOLEAN NOT NULL DEFAULT false,
    "replacesMemberId" TEXT,
    "exitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'UPCOMING',
    "statusBeforeDispute" "RoundStatus",
    "selectionMethod" "SelectionMethod" NOT NULL,
    "contributorCount" INTEGER,
    "fullPot" INTEGER,
    "winnerMemberId" TEXT,
    "winnerSelectedAt" TIMESTAMP(3),
    "selectionOverrideReason" TEXT,
    "biddingStatus" "BiddingStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "bidDiscount" INTEGER NOT NULL DEFAULT 0,
    "payoutToWinner" INTEGER,
    "discountRecipientCount" INTEGER NOT NULL DEFAULT 0,
    "discountSharePerMember" INTEGER NOT NULL DEFAULT 0,
    "expectedCollection" INTEGER,
    "actualCollection" INTEGER,
    "totalLateFees" INTEGER,
    "openingBalance" INTEGER NOT NULL DEFAULT 0,
    "calculatedClosingBalance" INTEGER,
    "actualClosingBalance" INTEGER,
    "reconciliationStatus" "ReconciliationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "reconciliationNote" TEXT,
    "payoutEntryId" TEXT,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_obligations" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "contributionDue" INTEGER NOT NULL,
    "discountCredit" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "round_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "discountAmount" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isWinning" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "roundId" TEXT,
    "ledgerRoundId" TEXT,
    "memberId" TEXT NOT NULL,
    "type" "EntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'OTHER',
    "referenceNumber" TEXT,
    "receiptPath" TEXT,
    "proofUrl" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "notes" TEXT,
    "status" "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "correctsEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "raisedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" "DisputeOutcome",
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "correctionEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_exits" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "settlement" "ExitSettlement" NOT NULL,
    "hadReceivedPot" BOOLEAN NOT NULL,
    "contributionsPaid" INTEGER NOT NULL,
    "potReceived" INTEGER NOT NULL,
    "remainingContributions" INTEGER NOT NULL,
    "arrears" INTEGER NOT NULL,
    "lateFeesOwed" INTEGER NOT NULL,
    "penalty" INTEGER NOT NULL,
    "amountOwedByMember" INTEGER NOT NULL,
    "amountOwedToMember" INTEGER NOT NULL,
    "replacementMemberId" TEXT,
    "reason" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_exits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT,
    "memberId" TEXT,
    "roundId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "emailTo" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "groups_inviteCode_key" ON "groups"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_replacesMemberId_key" ON "group_members"("replacesMemberId");

-- CreateIndex
CREATE INDEX "group_members_groupId_status_idx" ON "group_members"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_groupId_userId_key" ON "group_members"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_groupId_rotationOrder_key" ON "group_members"("groupId", "rotationOrder");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_payoutEntryId_key" ON "rounds"("payoutEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_groupId_roundNumber_key" ON "rounds"("groupId", "roundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_groupId_winnerMemberId_key" ON "rounds"("groupId", "winnerMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "round_obligations_roundId_memberId_key" ON "round_obligations"("roundId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "bids_roundId_memberId_key" ON "bids"("roundId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_seq_key" ON "ledger_entries"("seq");

-- CreateIndex
CREATE INDEX "ledger_entries_groupId_roundId_idx" ON "ledger_entries"("groupId", "roundId");

-- CreateIndex
CREATE INDEX "ledger_entries_groupId_memberId_idx" ON "ledger_entries"("groupId", "memberId");

-- CreateIndex
CREATE INDEX "ledger_entries_groupId_status_idx" ON "ledger_entries"("groupId", "status");

-- CreateIndex
CREATE INDEX "disputes_groupId_status_idx" ON "disputes"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "member_exits_memberId_key" ON "member_exits"("memberId");

-- CreateIndex
CREATE INDEX "audit_logs_groupId_createdAt_idx" ON "audit_logs"("groupId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_replacesMemberId_fkey" FOREIGN KEY ("replacesMemberId") REFERENCES "group_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_winnerMemberId_fkey" FOREIGN KEY ("winnerMemberId") REFERENCES "group_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_obligations" ADD CONSTRAINT "round_obligations_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_obligations" ADD CONSTRAINT "round_obligations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_ledgerRoundId_fkey" FOREIGN KEY ("ledgerRoundId") REFERENCES "rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_correctsEntryId_fkey" FOREIGN KEY ("correctsEntryId") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_exits" ADD CONSTRAINT "member_exits_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_exits" ADD CONSTRAINT "member_exits_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
