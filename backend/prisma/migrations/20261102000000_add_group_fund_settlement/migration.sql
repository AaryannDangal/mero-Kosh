-- Money is settled (end-of-cycle confirmation)
--
-- In real life a group may still be holding money when the rounds end: the
-- organiser takes everyone on a year-end trip or divides the balance between
-- members. The app only needs to record that the organiser has decided what
-- happened to that money — no amount, method or proof is required.
--
-- IF NOT EXISTS keeps this migration safe to re-apply after a failed deploy.

ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "fundSettledAt" TIMESTAMP;
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "fundSettledById" TEXT;
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "fundSettledAmount" INTEGER;
