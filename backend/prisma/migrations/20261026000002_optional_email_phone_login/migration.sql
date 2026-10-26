-- Email is optional for local account registration; phone is the unique login identifier.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

-- PostgreSQL permits multiple NULL values, preserving legacy and Google accounts
-- that have not yet supplied a phone number.
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
