-- Allow a member to win the pot multiple times
-- Remove the unique constraint that prevented multiple wins per cycle.
-- IF EXISTS: the constraint may already be gone on databases that were
-- repaired manually, and a missing constraint must never block a deploy.
ALTER TABLE "rounds"
  DROP CONSTRAINT IF EXISTS "rounds_groupId_winnerMemberId_key";

-- Track multiple pot obligations per member
-- Each time a member receives the pot, a new obligation is created
-- with its own principal, interest rate, and cleared status
CREATE TABLE IF NOT EXISTS "pot_obligations" (
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

CREATE INDEX IF NOT EXISTS "pot_obligations_groupId_memberId_idx" ON "pot_obligations"("groupId", "memberId");
CREATE INDEX IF NOT EXISTS "pot_obligations_groupId_isCleared_idx" ON "pot_obligations"("groupId", "isCleared");
