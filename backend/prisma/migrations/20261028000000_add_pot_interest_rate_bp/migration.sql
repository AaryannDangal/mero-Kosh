-- The "potInterestRateBp" column was added to prisma/schema.prisma (monthly interest
-- rate on the pot, in basis points) but no migration ever created the column in the
-- database. Every DB built with `prisma migrate deploy` therefore had a "groups" table
-- missing "potInterestRateBp", so Prisma failed with:
--   The column `groups.potInterestRateBp` does not exist in the current database.
-- which broke group creation and every read of the groups table.

ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "potInterestRateBp" INTEGER NOT NULL DEFAULT 100;
