import { Prisma } from '@prisma/client';
import type { Db } from './prisma';

export type AuditAction =
  | 'GROUP_CREATED' | 'GROUP_UPDATED' | 'GROUP_DELETED' | 'GROUP_RULES_CONFIRMED' | 'GROUP_STARTED'
  | 'GROUP_INVITE_REGENERATED' | 'GROUP_SETTLEMENT_CREATED' | 'GROUP_COMPLETED'
  | 'ACCOUNT_DELETED' | 'ORGANIZER_TRANSFERRED'
  | 'MEMBER_ADDED' | 'MEMBER_JOINED' | 'MEMBER_UPDATED' | 'MEMBER_REMOVED' | 'MEMBER_STATUS_CHANGED' | 'MEMBER_INVITED' | 'MEMBER_INVITE_ACCEPTED'
  | 'MEMBER_SUSPENDED' | 'MEMBER_EXITED' | 'MEMBER_REPLACED'
  | 'ROUND_CREATED' | 'ROUND_OPENED' | 'ROUND_CLOSED' | 'ROUND_STATUS_CHANGED'
  | 'BID_SUBMITTED' | 'BID_CHANGED' | 'BID_WITHDRAWN' | 'BIDDING_CLOSED' | 'WINNER_SELECTED'
  | 'PAYMENT_RECORDED' | 'PAYMENT_VERIFIED' | 'PAYMENT_REJECTED' | 'PROOF_ATTACHED'
  | 'PAYOUT_RECORDED' | 'CORRECTION_RECORDED' | 'MANUAL_OVERRIDE'
  | 'POT_REQUESTED' | 'POT_REQUEST_WITHDRAWN'
  | 'DISPUTE_OPENED' | 'DISPUTE_RESOLVED' | 'RECONCILIATION_MISMATCH_ACKNOWLEDGED';

export interface AuditInput {
  groupId?: string | null;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  reason?: string | null;
}

function toJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (v === undefined || v === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

/** Append an audit record. Pass the transaction client so it commits atomically with the change. */
export async function audit(db: Db, a: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      groupId: a.groupId ?? null,
      userId: a.userId ?? null,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId ?? null,
      oldValue: toJson(a.oldValue),
      newValue: toJson(a.newValue),
      ipAddress: a.ipAddress ?? null,
      reason: a.reason ?? null,
    },
  });
}
