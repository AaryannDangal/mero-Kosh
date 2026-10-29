-- Canonicalize previously Nepali-format phone values before accepting E.164.
-- Aggregate inspection found no invalid or colliding user numbers in the local DB.
UPDATE users
SET phone = CASE
  WHEN phone IS NULL THEN NULL
  WHEN regexp_replace(phone, '[[:space:]()-]', '', 'g') LIKE '+%' THEN regexp_replace(phone, '[[:space:]()-]', '', 'g')
  WHEN regexp_replace(phone, '[[:space:]()-]', '', 'g') LIKE '977%' THEN '+' || regexp_replace(phone, '[[:space:]()-]', '', 'g')
  WHEN regexp_replace(phone, '[[:space:]()-]', '', 'g') ~ '^9[0-9]{9}$' THEN '+977' || regexp_replace(phone, '[[:space:]()-]', '', 'g')
  WHEN regexp_replace(phone, '[[:space:]()-]', '', 'g') ~ '^0[0-9]{6,9}$' THEN '+977' || substr(regexp_replace(phone, '[[:space:]()-]', '', 'g'), 2)
  ELSE phone
END;

UPDATE group_members
SET phone = CASE
  WHEN phone IS NULL THEN NULL
  WHEN regexp_replace(phone, '[[:space:]()-]', '', 'g') LIKE '+%' THEN regexp_replace(phone, '[[:space:]()-]', '', 'g')
  WHEN regexp_replace(phone, '[[:space:]()-]', '', 'g') LIKE '977%' THEN '+' || regexp_replace(phone, '[[:space:]()-]', '', 'g')
  WHEN regexp_replace(phone, '[[:space:]()-]', '', 'g') ~ '^9[0-9]{9}$' THEN '+977' || regexp_replace(phone, '[[:space:]()-]', '', 'g')
  WHEN regexp_replace(phone, '[[:space:]()-]', '', 'g') ~ '^0[0-9]{6,9}$' THEN '+977' || substr(regexp_replace(phone, '[[:space:]()-]', '', 'g'), 2)
  ELSE phone
END;

ALTER TABLE users
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "AuthTokenPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

CREATE TABLE "auth_tokens" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "purpose" "AuthTokenPurpose" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "auth_tokens_tokenHash_key" ON "auth_tokens"("tokenHash");
CREATE INDEX "auth_tokens_userId_purpose_expiresAt_idx" ON "auth_tokens"("userId", "purpose", "expiresAt");

CREATE TABLE "group_invitations" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "acceptedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  CONSTRAINT "group_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_invitations_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "group_invitations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "group_members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "group_invitations_tokenHash_key" ON "group_invitations"("tokenHash");
CREATE INDEX "group_invitations_groupId_memberId_expiresAt_idx" ON "group_invitations"("groupId", "memberId", "expiresAt");
