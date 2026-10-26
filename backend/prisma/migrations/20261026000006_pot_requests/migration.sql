-- Add the table required by the existing admin-selection pot request workflow.
CREATE TABLE "pot_requests" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pot_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pot_requests_roundId_memberId_key" ON "pot_requests"("roundId", "memberId");
CREATE INDEX "pot_requests_groupId_roundId_createdAt_idx" ON "pot_requests"("groupId", "roundId", "createdAt");

ALTER TABLE "pot_requests" ADD CONSTRAINT "pot_requests_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pot_requests" ADD CONSTRAINT "pot_requests_roundId_fkey"
    FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pot_requests" ADD CONSTRAINT "pot_requests_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "group_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
