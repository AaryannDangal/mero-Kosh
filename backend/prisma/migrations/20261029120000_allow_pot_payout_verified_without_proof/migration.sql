-- Allow VERIFIED POT_PAYOUT ledger entries without a receipt/proof URL.
-- Members pay each other directly (cash, bank, eSewa, Khalti) and the admin
-- only keeps records, so a pot payout can be confirmed without uploading proof.
ALTER TABLE "ledger_entries"
  DROP CONSTRAINT "ledger_verified_requires_proof",
  ADD CONSTRAINT "ledger_verified_requires_proof" CHECK (
    "status" <> 'VERIFIED'
    OR "type" IN ('BID_DISCOUNT','CORRECTION','MANUAL_ADJUSTMENT','POT_PAYOUT')
    OR "receiptPath" IS NOT NULL
    OR "proofUrl" IS NOT NULL
    OR ("cashReceivedInPerson" AND "method" = 'CASH' AND "type" IN ('CONTRIBUTION','LATE_FEE','PENALTY'))
  );
