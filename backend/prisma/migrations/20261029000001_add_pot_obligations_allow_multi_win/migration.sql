-- Allow a member to win the pot multiple times
-- Remove the unique constraint that prevented multiple wins per cycle
ALTER TABLE "rounds"
  DROP CONSTRAINT "rounds_groupId_winnerMemberId_key";

-- Track multiple pot obligations per member
-- Each time a member receives the pot, a new obligation is created
-- with its own principal, interest rate, and cleared status
CREATE TABLE "pot_obligations" (
  "id"               TEXT       NOT NULL PRIMARY KEY,
  "groupId"          TEXT       NOT NULL,
  "memberId"         TEXT       NOT NULL,
  "roundId"          TEXT       NOT NULL,
  "originalAmount"   INTEGER    NOT NULL,
  "remainingPrincipal" INTEGER  NOT NULL,
  "interestRateBp"   INTEGER    NOT NULL DEFAULT 100,
  "isCleared"        BOOLEAN    NOT NULL DEFAULT false,
  "clearedAt"        TIMESTAMP,
  "createdAt"        TIMESTAMP  NOT NULL DEFAULT now(),

  CONSTRAINT "pot_obligations_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE,
  CONSTRAINT "pot_obligations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "group_members"("id") ON DELETE CASCADE,
  CONSTRAINT "pot_obligations_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE CASCADE
);

CREATE INDEX "pot_obligations_groupId_memberId_idx" ON "pot_obligations"("groupId", "memberId");
CREATE INDEX "pot_obligations_groupId_isCleared_idx" ON "pot_obligations"("groupId", "isCleared");
