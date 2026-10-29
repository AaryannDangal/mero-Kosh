import type { GroupMember, LedgerEntry } from '@prisma/client';

/** Members see only their own private data; managers see everything. */
export function serializeMember(m: GroupMember, opts: { manager: boolean; self: boolean }) {
  const base = {
    id: m.id, fullName: m.fullName, role: m.role, status: m.status, isContributor: m.isContributor, rotationOrder: m.rotationOrder,
    hasReceivedPot: m.hasReceivedPot, joinedAt: m.joinedAt, hasPhoto: !!m.profilePhotoPath, linkedAccount: !!m.userId,
    replacesMemberId: m.replacesMemberId, exitedAt: m.exitedAt,
  };
  if (!opts.manager && !opts.self) return base;
  return { ...base, phone: m.phone, email: m.email, paymentMethod: m.paymentMethod, paymentIdentifier: m.paymentIdentifier, bankName: m.bankName };
}

/** The shared ledger is visible to all members, but proof, references and notes of other members' entries are private. */
export function serializeEntry(e: LedgerEntry & { member?: { fullName: string } | null }, opts: { manager: boolean; ownMemberId?: string }) {
  const own = opts.ownMemberId === e.memberId;
  const full = opts.manager || own;
  return {
    id: e.id, seq: e.seq, groupId: e.groupId, roundId: e.roundId, ledgerRoundId: e.ledgerRoundId, memberId: e.memberId,
    memberName: e.member?.fullName, type: e.type, amount: e.amount, method: e.method, paidAt: e.paidAt, status: e.status,
    recordedById: e.recordedById, verifiedById: e.verifiedById, verifiedAt: e.verifiedAt, correctsEntryId: e.correctsEntryId, createdAt: e.createdAt,
    hasReceipt: !!e.receiptPath, cashReceivedInPerson: e.cashReceivedInPerson,
    ...(full ? { referenceNumber: e.referenceNumber, proofUrl: e.proofUrl, notes: e.notes, rejectedReason: e.rejectedReason } : {}),
  };
}
