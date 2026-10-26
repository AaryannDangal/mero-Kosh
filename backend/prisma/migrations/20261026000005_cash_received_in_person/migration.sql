ALTER TABLE "ledger_entries"
  ADD COLUMN "cashReceivedInPerson" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ledger_entries"
  DROP CONSTRAINT "ledger_verified_requires_proof",
  ADD CONSTRAINT "ledger_verified_requires_proof" CHECK (
    "status" <> 'VERIFIED'
    OR "type" IN ('BID_DISCOUNT','CORRECTION','MANUAL_ADJUSTMENT')
    OR "receiptPath" IS NOT NULL
    OR "proofUrl" IS NOT NULL
    OR ("cashReceivedInPerson" AND "method" = 'CASH' AND "type" IN ('CONTRIBUTION','LATE_FEE','PENALTY'))
  ),
  ADD CONSTRAINT "ledger_cash_received_confirmation_consistent" CHECK (
    NOT "cashReceivedInPerson"
    OR ("status" = 'VERIFIED' AND "method" = 'CASH' AND "type" IN ('CONTRIBUTION','LATE_FEE','PENALTY'))
  );
