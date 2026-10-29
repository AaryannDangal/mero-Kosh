-- Business-rule constraints enforced by PostgreSQL itself, so that even a buggy
-- service or a manual SQL session cannot silently corrupt the ledger.

-- groups ---------------------------------------------------------------------
ALTER TABLE "groups"
  ADD CONSTRAINT "groups_contribution_positive" CHECK ("contributionAmount" > 0),
  ADD CONSTRAINT "groups_member_count_range" CHECK ("memberCount" BETWEEN 2 AND 100),
  ADD CONSTRAINT "groups_due_day_range" CHECK (
    ("frequency" = 'MONTHLY' AND "collectionDueDay" BETWEEN 1 AND 28)
    OR ("frequency" IN ('WEEKLY','BIWEEKLY') AND "collectionDueDay" BETWEEN 0 AND 6)
  ),
  ADD CONSTRAINT "groups_grace_non_negative" CHECK ("gracePeriodDays" >= 0 AND "gracePeriodDays" <= 60),
  ADD CONSTRAINT "groups_late_fee_non_negative" CHECK ("lateFeeValue" >= 0 AND ("lateFeeCap" IS NULL OR "lateFeeCap" >= 0)),
  ADD CONSTRAINT "groups_late_fee_pct_range" CHECK ("lateFeeType" <> 'PERCENTAGE' OR "lateFeeValue" <= 10000),
  ADD CONSTRAINT "groups_min_bid_non_negative" CHECK ("minBidDiscount" >= 0),
  ADD CONSTRAINT "groups_exit_penalty_range" CHECK ("earlyExitPenaltyBp" BETWEEN 0 AND 10000);

-- group members ----------------------------------------------------------------
ALTER TABLE "group_members"
  ADD CONSTRAINT "members_rotation_positive" CHECK ("rotationOrder" IS NULL OR "rotationOrder" >= 1),
  ADD CONSTRAINT "members_viewer_not_contributor" CHECK ("role" <> 'VIEWER' OR "isContributor" = false);

-- rounds -----------------------------------------------------------------------
ALTER TABLE "rounds"
  ADD CONSTRAINT "rounds_number_positive" CHECK ("roundNumber" >= 1),
  ADD CONSTRAINT "rounds_pot_non_negative" CHECK ("fullPot" IS NULL OR "fullPot" >= 0),
  ADD CONSTRAINT "rounds_bid_discount_range" CHECK ("bidDiscount" >= 0 AND ("fullPot" IS NULL OR "bidDiscount" <= "fullPot")),
  ADD CONSTRAINT "rounds_payout_formula" CHECK ("payoutToWinner" IS NULL OR "fullPot" IS NULL OR "payoutToWinner" = "fullPot" - "bidDiscount"),
  ADD CONSTRAINT "rounds_due_in_period" CHECK ("periodStart" <= "periodEnd");

-- obligations --------------------------------------------------------------------
ALTER TABLE "round_obligations"
  ADD CONSTRAINT "obligations_amounts_valid" CHECK ("contributionDue" >= 0 AND "discountCredit" >= 0 AND "discountCredit" <= "contributionDue");

-- bids ---------------------------------------------------------------------------
ALTER TABLE "bids"
  ADD CONSTRAINT "bids_discount_non_negative" CHECK ("discountAmount" >= 0);

-- ledger entries -----------------------------------------------------------------
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_amount_sign" CHECK (
    ("type" IN ('CORRECTION','MANUAL_ADJUSTMENT') AND "amount" <> 0)
    OR ("type" NOT IN ('CORRECTION','MANUAL_ADJUSTMENT') AND "amount" > 0)
  ),
  ADD CONSTRAINT "ledger_correction_has_target" CHECK ("type" <> 'CORRECTION' OR "correctsEntryId" IS NOT NULL),
  ADD CONSTRAINT "ledger_adjustment_has_reason" CHECK ("type" NOT IN ('CORRECTION','MANUAL_ADJUSTMENT') OR ("notes" IS NOT NULL AND length(trim("notes")) > 0)),
  ADD CONSTRAINT "ledger_verified_requires_proof" CHECK (
    "status" <> 'VERIFIED'
    OR "type" IN ('BID_DISCOUNT','CORRECTION','MANUAL_ADJUSTMENT')
    OR "receiptPath" IS NOT NULL
    OR "proofUrl" IS NOT NULL
  ),
  ADD CONSTRAINT "ledger_verified_has_verifier" CHECK ("status" <> 'VERIFIED' OR ("verifiedById" IS NOT NULL AND "verifiedAt" IS NOT NULL)),
  ADD CONSTRAINT "ledger_rejected_has_reason" CHECK ("status" <> 'REJECTED' OR "rejectedReason" IS NOT NULL);

-- Verified / rejected entries are immutable. Only PENDING rows may change, and
-- only towards VERIFIED/REJECTED or by attaching proof. Deletes are forbidden.
CREATE OR REPLACE FUNCTION ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger entries cannot be deleted (entry %)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'ledger entry % is % and immutable; create a CORRECTION entry instead', OLD.id, OLD."status" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."amount" <> OLD."amount" OR NEW."type" <> OLD."type" OR NEW."memberId" <> OLD."memberId"
     OR NEW."groupId" <> OLD."groupId" OR NEW."roundId" IS DISTINCT FROM OLD."roundId" THEN
    RAISE EXCEPTION 'amount, type, member, group and round of a ledger entry cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_immutable_trg
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();

-- Audit log is append-only.
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit log is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only_trg
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
