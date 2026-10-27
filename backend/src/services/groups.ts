import type { Group, GroupMember, GroupRole, MemberStatus, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { now } from '../lib/clock';
import { generateInviteCode } from '../lib/inviteCode';
import { hashPassword, verifyPassword } from '../lib/auth';
import { buildRules } from '../domain/rules';
import { calculateExitQuote, looksLikeCardNumber } from '../domain/calculations';
import { distributeEvenlyFor } from '../domain/money';
import { loadGroupState } from './state';
import { notifyMembers } from './notifications';
import type { Actor } from './rounds';
import { config } from '../config';

const TX_OPTS = { timeout: 20000, maxWait: 10000 } as const;

export interface GroupInput {
  name: string;
  description?: string | null;
  currency: string;
  contributionAmount: number;
  memberCount: number;
  startDate: Date;
  frequency: Group['frequency'];
  collectionDueDay: number;
  selectionMethod: Group['selectionMethod'];
  lateFeeType: Group['lateFeeType'];
  lateFeeValue: number;
  lateFeeCap?: number | null;
  gracePeriodDays: number;
  continueAfterPot: boolean;
  potInterestRateBp: number;
  minBidDiscount: number;
  bidWinRule: Group['bidWinRule'];
  tieBreakRule: Group['tieBreakRule'];
  missedPaymentRules?: string | null;
  earlyExitRules?: string | null;
  earlyExitPenaltyBp: number;
}

export interface CreateGroupInput extends GroupInput { joinPassword?: string }

/** Fields that change the financial rules: editing them un-confirms the rules. */
const RULE_FIELDS: (keyof GroupInput)[] = [
  'currency', 'contributionAmount', 'memberCount', 'startDate', 'frequency', 'collectionDueDay', 'selectionMethod',
  'lateFeeType', 'lateFeeValue', 'lateFeeCap', 'gracePeriodDays', 'continueAfterPot', 'potInterestRateBp', 'minBidDiscount', 'bidWinRule',
  'tieBreakRule', 'missedPaymentRules', 'earlyExitRules', 'earlyExitPenaltyBp',
];

export interface MemberDetails {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  paymentMethod?: GroupMember['paymentMethod'];
  paymentIdentifier?: string | null;
  bankName?: string | null;
}

function guardIdentifier(id?: string | null) {
  if (id && looksLikeCardNumber(id)) {
    throw unprocessable('Do not store full card numbers. Use an eSewa/Khalti ID, a masked bank account (e.g. ****1234) or phone number.');
  }
}

async function uniqueInviteCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateInviteCode(4);
    if (!(await prisma.group.findUnique({ where: { inviteCode: code } }))) return code;
  }
  throw new Error('Could not generate a unique invite code');
}

export async function createGroup(input: CreateGroupInput, organizer: { userId: string; fullName: string; email: string | null; phone: string | null; participates: boolean }, actor: Actor) {
  const inviteCode = await uniqueInviteCode();
  const { joinPassword, ...groupInput } = input as CreateGroupInput & { organizerParticipates?: boolean };
  delete (groupInput as Record<string, unknown>).organizerParticipates;
  const joinPasswordHash = joinPassword ? await hashPassword(joinPassword) : null;
  return prisma.$transaction(async (tx) => {
    const group = await tx.group.create({ data: { ...groupInput, inviteCode, joinPasswordHash, createdById: organizer.userId } });
    const member = await tx.groupMember.create({
      data: {
        groupId: group.id, userId: organizer.userId, fullName: organizer.fullName, email: organizer.email, phone: organizer.phone,
        role: 'ORGANIZER', isContributor: organizer.participates,
      },
    });
    await audit(tx, { groupId: group.id, userId: actor.userId, action: 'GROUP_CREATED', entityType: 'Group', entityId: group.id, newValue: { ...groupInput, joinCode: inviteCode }, ipAddress: actor.ip });
    await audit(tx, { groupId: group.id, userId: actor.userId, action: 'MEMBER_ADDED', entityType: 'GroupMember', entityId: member.id, newValue: { fullName: member.fullName, role: 'ORGANIZER', isContributor: member.isContributor }, ipAddress: actor.ip });
    return group;
  }, TX_OPTS);
}

export async function changeGroupJoinPassword(group: Group, password: string, actor: Actor) {
  const joinPasswordHash = await hashPassword(password);
  const inviteCode = await uniqueInviteCode();
  const updated = await prisma.group.update({ where: { id: group.id }, data: { joinPasswordHash, inviteCode } });
  await audit(prisma, {
    groupId: group.id, userId: actor.userId, action: 'GROUP_JOIN_PASSWORD_CHANGED', entityType: 'Group', entityId: group.id,
    oldValue: { joinCode: group.inviteCode }, newValue: { passwordChanged: true, joinCode: inviteCode }, ipAddress: actor.ip,
  });
  return updated;
}

export async function requestGroupJoin(code: string, password: string, user: { id: string; fullName: string; email: string | null; phone: string | null }, actor: Actor) {
  const group = await prisma.group.findFirst({ where: { inviteCode: code, deletedAt: null } });
  const passwordHash = group?.joinPasswordHash ?? '$2b$12$Na0VkQS4Y0J1qELVwCmQ6u8Xi3wUCFJYSJnQGydQuiEbN.M95aGa.';
  const passwordMatches = await verifyPassword(password, passwordHash).catch(() => false);
  if (!group || !group.joinPasswordHash || !passwordMatches) throw forbidden('That group code or password is incorrect');
  if (group.status !== 'DRAFT') throw conflict('This group has already started and is no longer accepting new contributing members');
  if (!user.phone) throw unprocessable('Add a phone number to your account before requesting to join');

  return prisma.$transaction(async (tx) => {
    const existingMember = await tx.groupMember.findFirst({ where: { groupId: group.id, userId: user.id } });
    if (existingMember) return { status: 'APPROVED' as const, groupId: group.id };

    const prior = await tx.groupJoinRequest.findUnique({ where: { groupId_userId: { groupId: group.id, userId: user.id } } });
    if (prior?.status === 'PENDING') return { status: 'PENDING' as const };
    if (prior?.status === 'APPROVED') return { status: 'APPROVED' as const, groupId: group.id };

    const matchingSeat = await tx.groupMember.findFirst({ where: { groupId: group.id, userId: null, phone: user.phone, isContributor: true, status: { not: 'EXITED' } } });
    const seats = await tx.groupMember.count({ where: { groupId: group.id, isContributor: true, status: { not: 'EXITED' } } });
    if (!matchingSeat && seats >= group.memberCount) throw conflict('This group has no open member seats');
    const request = prior
      ? await tx.groupJoinRequest.update({ where: { id: prior.id }, data: { status: 'PENDING' } })
      : await tx.groupJoinRequest.create({ data: { groupId: group.id, userId: user.id } });
    const organizers = await tx.groupMember.findMany({ where: { groupId: group.id, role: { in: ['ORGANIZER', 'CO_ORGANIZER'] }, userId: { not: null } }, select: { userId: true } });
    for (const organizer of organizers) {
      if (!organizer.userId) continue;
      await tx.notification.create({
        data: { groupId: group.id, userId: organizer.userId, type: 'GENERAL', title: 'New request to join', body: `${user.fullName} asked to join. Review the request in the group’s Members page.` },
      });
    }
    await audit(tx, {
      groupId: group.id, userId: user.id, action: 'GROUP_JOIN_REQUESTED', entityType: 'GroupJoinRequest', entityId: request.id,
      newValue: { status: 'PENDING' }, ipAddress: actor.ip,
    });
    return { status: 'PENDING' as const };
  }, TX_OPTS);
}

export async function listGroupJoinRequests(groupId: string) {
  return prisma.groupJoinRequest.findMany({
    where: { groupId, status: 'PENDING' },
    include: { user: { select: { fullName: true, phone: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function reviewGroupJoinRequest(group: Group, requestId: string, approve: boolean, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "groups" WHERE "id" = ${group.id} FOR UPDATE`;
    const request = await tx.groupJoinRequest.findFirst({ where: { id: requestId, groupId: group.id, status: 'PENDING' }, include: { user: true } });
    if (!request) throw notFound('Join request');
    if (approve) {
      const currentGroup = await tx.group.findUniqueOrThrow({ where: { id: group.id } });
      if (currentGroup.status !== 'DRAFT') throw conflict('New contributing members cannot be approved after the group starts');
      if (!request.user.phone) throw unprocessable('This account needs a phone number before it can join');
      const matchingSeat = await tx.groupMember.findFirst({ where: { groupId: group.id, userId: null, phone: request.user.phone, isContributor: true, status: { not: 'EXITED' } } });
      if (matchingSeat) {
        await tx.groupMember.update({ where: { id: matchingSeat.id }, data: { userId: request.userId } });
      } else {
        const seats = await tx.groupMember.count({ where: { groupId: group.id, isContributor: true, status: { not: 'EXITED' } } });
        if (seats >= currentGroup.memberCount) throw conflict('All member seats are filled');
        await tx.groupMember.create({
          data: {
            groupId: group.id, userId: request.userId, fullName: request.user.fullName, phone: request.user.phone,
            email: request.user.email, role: 'MEMBER', isContributor: true,
          },
        });
      }
    }
    const status = approve ? 'APPROVED' : 'REJECTED';
    const reviewed = await tx.groupJoinRequest.update({ where: { id: request.id }, data: { status } });
    await audit(tx, {
      groupId: group.id, userId: actor.userId, action: 'GROUP_JOIN_REQUEST_REVIEWED', entityType: 'GroupJoinRequest', entityId: request.id,
      oldValue: { status: 'PENDING' }, newValue: { status, applicantUserId: request.userId }, ipAddress: actor.ip,
    });
    await tx.notification.create({
      data: {
        groupId: group.id, userId: request.userId, type: 'GENERAL',
        title: approve ? 'Join request approved' : 'Join request declined',
        body: approve ? `You are now a member of ${group.name}.` : `Your request to join ${group.name} was declined.`,
      },
    });
    return reviewed;
  }, TX_OPTS);
}

export async function updateGroup(group: Group, input: Partial<GroupInput>, actor: Actor) {
  const changingRules = RULE_FIELDS.filter((k) => k in input && JSON.stringify((input as Record<string, unknown>)[k]) !== JSON.stringify((group as unknown as Record<string, unknown>)[k]));
  if (group.status !== 'DRAFT' && changingRules.length) {
    throw conflict(`These settings cannot change after the group has started: ${changingRules.join(', ')}`);
  }
  return prisma.$transaction(async (tx) => {
    if (input.memberCount !== undefined) {
      const seats = await tx.groupMember.count({ where: { groupId: group.id, isContributor: true, status: { not: 'EXITED' } } });
      if (input.memberCount < seats) throw unprocessable(`There are already ${seats} contributing members`);
    }
    const data: Prisma.GroupUpdateInput = { ...input };
    if (changingRules.length) Object.assign(data, { rulesConfirmedAt: null, rulesConfirmedById: null });
    const updated = await tx.group.update({ where: { id: group.id }, data });
    const old: Record<string, unknown> = {};
    for (const k of Object.keys(input)) old[k] = (group as unknown as Record<string, unknown>)[k];
    await audit(tx, {
      groupId: group.id, userId: actor.userId, action: 'GROUP_UPDATED', entityType: 'Group', entityId: group.id,
      oldValue: old, newValue: input, reason: changingRules.length && group.rulesConfirmedAt ? 'Rule change - confirmation reset' : null, ipAddress: actor.ip,
    });
    return updated;
  }, TX_OPTS);
}

export function rulesFor(group: Group) {
  return buildRules(group);
}

export async function confirmRules(group: Group, actor: Actor) {
  if (group.status !== 'DRAFT') throw conflict('Rules can only be confirmed before the first round');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.group.update({ where: { id: group.id }, data: { rulesConfirmedAt: now(), rulesConfirmedById: actor.userId } });
    await audit(tx, { groupId: group.id, userId: actor.userId, action: 'GROUP_RULES_CONFIRMED', entityType: 'Group', entityId: group.id, newValue: buildRules(group), ipAddress: actor.ip });
    return updated;
  }, TX_OPTS);
}

export async function softDeleteGroup(group: Group, reason: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await tx.group.update({ where: { id: group.id }, data: { deletedAt: now() } });
    await audit(tx, { groupId: group.id, userId: actor.userId, action: 'GROUP_DELETED', entityType: 'Group', entityId: group.id, oldValue: { status: group.status }, reason, ipAddress: actor.ip });
  }, TX_OPTS);
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
async function assertSeatAvailable(groupId: string, memberCount: number) {
  const seats = await prisma.groupMember.count({ where: { groupId, isContributor: true, status: { not: 'EXITED' } } });
  if (seats >= memberCount) throw conflict(`All ${memberCount} member seats are filled`);
}

export async function addMember(group: Group, d: MemberDetails & { role: GroupRole; rotationOrder?: number | null }, actor: Actor) {
  guardIdentifier(d.paymentIdentifier);
  const isContributor = d.role !== 'VIEWER';
  if (isContributor && group.status !== 'DRAFT') {
    throw conflict('Contributing members can only be added before the group starts. Use the early-exit replacement flow instead.');
  }
  if (isContributor) await assertSeatAvailable(group.id, group.memberCount);
  if (d.role === 'ORGANIZER') throw unprocessable('A group has exactly one organizer');
  if (!d.phone) throw unprocessable('A phone number is required for every group member');
  const email = d.email?.toLowerCase().trim() || null;
  return prisma.$transaction(async (tx) => {
    const member = await tx.groupMember.create({
      data: {
        groupId: group.id, fullName: d.fullName, phone: d.phone, email, paymentMethod: d.paymentMethod,
        paymentIdentifier: d.paymentIdentifier, bankName: d.bankName, role: d.role, isContributor, rotationOrder: d.rotationOrder ?? null,
      },
    });
    await audit(tx, { groupId: group.id, userId: actor.userId, action: 'MEMBER_ADDED', entityType: 'GroupMember', entityId: member.id, newValue: { fullName: d.fullName, role: d.role, isContributor, rotationOrder: d.rotationOrder }, ipAddress: actor.ip });
    return member;
  }, TX_OPTS);
}

const inviteHash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function issueMemberInvitation(group: Group, memberId: string, actor: Actor) {
  const member = await prisma.groupMember.findFirst({ where: { id: memberId, groupId: group.id } });
  if (!member) throw notFound('Member');
  if (member.userId) throw conflict('This member already has an account linked');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    // Issuing a replacement revokes any older unaccepted invite for this seat.
    await tx.groupInvitation.updateMany({ where: { memberId, acceptedAt: null, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date() } });
    const invitation = await tx.groupInvitation.create({
      data: { tokenHash: inviteHash(token), groupId: group.id, memberId, createdById: actor.userId, expiresAt },
    });
    await audit(tx, { groupId: group.id, userId: actor.userId, action: 'MEMBER_INVITED', entityType: 'GroupInvitation', entityId: invitation.id, newValue: { memberId, expiresAt }, ipAddress: actor.ip });
  }, TX_OPTS);
  return { inviteUrl: `${config.appUrl.replace(/\/$/, '')}/invite/${token}`, expiresAt };
}

export async function previewMemberInvitation(token: string) {
  const invitation = await prisma.groupInvitation.findUnique({
    where: { tokenHash: inviteHash(token) },
    include: { group: { select: { id: true, name: true, deletedAt: true } }, member: { select: { id: true, fullName: true, userId: true } } },
  });
  if (!invitation || invitation.expiresAt <= new Date() || invitation.group.deletedAt || invitation.acceptedAt || invitation.member.userId) throw notFound('Invitation');
  return { groupId: invitation.group.id, groupName: invitation.group.name, invitedName: invitation.member.fullName, expiresAt: invitation.expiresAt };
}

export async function acceptMemberInvitation(token: string, userId: string, actor: Actor) {
  const tokenHash = inviteHash(token);
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.groupInvitation.findUnique({ where: { tokenHash }, include: { group: true, member: true } });
    if (!invitation || invitation.expiresAt <= new Date() || invitation.group.deletedAt) throw notFound('Invitation');
    if (invitation.acceptedAt) {
      if (invitation.acceptedById === userId) return { groupId: invitation.groupId };
      throw conflict('This invitation has already been accepted');
    }
    if (invitation.member.userId) throw conflict('This member seat is already linked to an account');
    if (await tx.groupMember.findFirst({ where: { groupId: invitation.groupId, userId } })) throw conflict('You are already a member of this group');
    const claimed = await tx.groupInvitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date(), acceptedById: userId },
    });
    if (claimed.count !== 1) throw conflict('This invitation was already accepted');
    const member = await tx.groupMember.update({ where: { id: invitation.memberId, userId: null }, data: { userId } });
    await audit(tx, { groupId: invitation.groupId, userId, action: 'MEMBER_INVITE_ACCEPTED', entityType: 'GroupInvitation', entityId: invitation.id, newValue: { memberId: member.id }, ipAddress: actor.ip });
    return { groupId: invitation.groupId };
  }, TX_OPTS);
}

export async function updateMember(
  group: Group,
  caller: GroupMember,
  memberId: string,
  d: Partial<MemberDetails> & { role?: GroupRole; rotationOrder?: number | null; profilePhotoPath?: string },
  actor: Actor,
) {
  guardIdentifier(d.paymentIdentifier);
  const member = await prisma.groupMember.findFirst({ where: { id: memberId, groupId: group.id } });
  if (!member) throw notFound('Member');
  const isManager = caller.role === 'ORGANIZER' || caller.role === 'CO_ORGANIZER';
  const isSelf = caller.id === member.id;
  if (!isManager && !isSelf) throw forbidden();
  if (!isManager && (d.role !== undefined || d.rotationOrder !== undefined)) throw forbidden('Only organizers can change roles or rotation order');
  if (d.role !== undefined && d.role !== member.role) {
    if (member.role === 'ORGANIZER') throw forbidden('The organizer role cannot be changed');
    if (d.role === 'ORGANIZER') throw unprocessable('A group has exactly one organizer');
    if (d.role === 'VIEWER' && member.isContributor) throw unprocessable('A contributing member cannot become a viewer');
    if (member.role === 'VIEWER' && d.role !== 'VIEWER') throw unprocessable('Viewers cannot become contributing members after creation; add them as a member instead');
  }
  if (d.rotationOrder !== undefined && group.status !== 'DRAFT') throw conflict('Rotation order is fixed once the group has started');
  if (d.rotationOrder != null && (d.rotationOrder < 1 || d.rotationOrder > group.memberCount)) throw unprocessable(`Rotation order must be between 1 and ${group.memberCount}`);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.groupMember.update({ where: { id: memberId }, data: { ...d, email: d.email?.toLowerCase() ?? undefined } });
    const old: Record<string, unknown> = {};
    for (const k of Object.keys(d)) old[k] = (member as unknown as Record<string, unknown>)[k];
    await audit(tx, { groupId: group.id, userId: actor.userId, action: 'MEMBER_UPDATED', entityType: 'GroupMember', entityId: memberId, oldValue: old, newValue: d, ipAddress: actor.ip });
    return updated;
  }, TX_OPTS);
}

const MANUAL_STATUSES: MemberStatus[] = ['ACTIVE', 'WAITING', 'SUSPENDED', 'DEFAULTED'];

export async function changeMemberStatus(group: Group, memberId: string, status: MemberStatus, reason: string, actor: Actor) {
  if (!MANUAL_STATUSES.includes(status)) throw unprocessable('Use the early-exit flow to exit a member; RECEIVED_POT is set automatically when a round closes');
  const member = await prisma.groupMember.findFirst({ where: { id: memberId, groupId: group.id } });
  if (!member) throw notFound('Member');
  if (member.status === 'EXITED') throw conflict('Exited members cannot change status');
  let target = status;
  // "restoring" a member derives the right status from their pot history
  if (status === 'ACTIVE' || status === 'WAITING') target = member.hasReceivedPot ? 'RECEIVED_POT' : group.status === 'DRAFT' ? 'ACTIVE' : 'WAITING';
  return prisma.$transaction(async (tx) => {
    const updated = await tx.groupMember.update({ where: { id: memberId }, data: { status: target } });
    await audit(tx, {
      groupId: group.id, userId: actor.userId, action: target === 'SUSPENDED' ? 'MEMBER_SUSPENDED' : 'MEMBER_STATUS_CHANGED',
      entityType: 'GroupMember', entityId: memberId, oldValue: { status: member.status }, newValue: { status: target }, reason, ipAddress: actor.ip,
    });
    await notifyMembers(tx, {
      groupId: group.id, memberIds: [memberId], type: 'GENERAL',
      title: `Your status changed to ${target} / तपाईंको स्थिति परिवर्तन भयो`,
      body: `Your membership status in "${group.name}" is now ${target}. Reason: ${reason}`,
    });
    return updated;
  }, TX_OPTS);
}

export async function removeMember(group: Group, memberId: string, reason: string, actor: Actor) {
  const member = await prisma.groupMember.findFirst({ where: { id: memberId, groupId: group.id } });
  if (!member) throw notFound('Member');
  if (member.role === 'ORGANIZER') throw forbidden('The organizer cannot be removed');
  if (group.status !== 'DRAFT' && member.isContributor) throw conflict('Contributing members cannot be removed after the group starts; use early exit');
  const entries = await prisma.ledgerEntry.count({ where: { memberId } });
  if (entries) throw conflict('Member has ledger entries and cannot be removed');
  return prisma.$transaction(async (tx) => {
    await tx.groupMember.delete({ where: { id: memberId } });
    await audit(tx, { groupId: group.id, userId: actor.userId, action: 'MEMBER_REMOVED', entityType: 'GroupMember', entityId: memberId, oldValue: { fullName: member.fullName, role: member.role }, reason, ipAddress: actor.ip });
  }, TX_OPTS);
}

// ---------------------------------------------------------------------------
// Early exit
// ---------------------------------------------------------------------------
export async function exitQuote(group: Group, memberId: string) {
  const state = await loadGroupState(prisma, group.id, now());
  const b = state.balances.get(memberId);
  if (!b) throw notFound('Member');
  const upcoming = state.rounds.filter((r) => r.status === 'UPCOMING').length;
  const future = b.hasReceivedPot && group.continueAfterPot ? upcoming * group.contributionAmount : 0;
  // arrears for exit purposes include the current open round's unpaid amount
  const unpaidOpened = b.rounds.reduce((a, r) => a + r.outstanding, 0);
  const quote = calculateExitQuote({
    hasReceivedPot: b.hasReceivedPot,
    contributionsPaid: b.totals.contributions,
    potReceived: b.totals.potReceived,
    arrears: unpaidOpened,
    lateFeesOwed: b.lateFeeOutstanding,
    futureContributions: future,
    earlyExitPenaltyBp: group.earlyExitPenaltyBp,
    netPosition: b.totals.netPosition,
  });
  return { member: { id: b.memberId, fullName: b.fullName, hasReceivedPot: b.hasReceivedPot }, balance: b, upcomingRounds: upcoming, ...quote };
}

export async function exitMember(
  group: Group,
  memberId: string,
  input: { settlement: 'PAY_REMAINING' | 'REPLACEMENT' | 'REFUND_AT_CYCLE_END'; reason: string; replacement?: MemberDetails },
  actor: Actor,
) {
  if (group.status !== 'ACTIVE') throw conflict('Early exit applies to running groups. Before the start, simply remove the member.');
  const q = await exitQuote(group, memberId);
  const member = await prisma.groupMember.findFirstOrThrow({ where: { id: memberId } });
  if (member.status === 'EXITED') throw conflict('Member already exited');
  if (member.role === 'ORGANIZER') throw forbidden('The organizer cannot exit their own group');
  const openRound = await prisma.round.findFirst({ where: { groupId: group.id, status: { in: ['COLLECTING', 'PAYOUT_PENDING', 'DISPUTED'] } } });
  if (openRound?.winnerMemberId === memberId) throw conflict('This member is the current round recipient. Override the winner first.');
  if (input.settlement === 'REPLACEMENT' && !input.replacement) throw unprocessable('Replacement member details are required');
  if (input.settlement === 'REFUND_AT_CYCLE_END' && member.hasReceivedPot) throw unprocessable('A member who received the pot must pay the remaining amount or provide a replacement');
  if (input.settlement === 'PAY_REMAINING' && !member.hasReceivedPot) throw unprocessable('PAY_REMAINING applies to members who already received the pot');
  if (input.replacement) guardIdentifier(input.replacement.paymentIdentifier);

  return prisma.$transaction(async (tx) => {
    const rotationOrder = member.rotationOrder;
    await tx.groupMember.update({ where: { id: memberId }, data: { status: 'EXITED', exitedAt: now(), rotationOrder: null } });
    if (openRound) await tx.bid.deleteMany({ where: { roundId: openRound.id, memberId } });
    let replacementId: string | null = null;
    if (input.settlement === 'REPLACEMENT' && input.replacement) {
      const email = input.replacement.email?.toLowerCase() || null;
      const rep = await tx.groupMember.create({
        data: {
          groupId: group.id, fullName: input.replacement.fullName, phone: input.replacement.phone, email,
          paymentMethod: input.replacement.paymentMethod, paymentIdentifier: input.replacement.paymentIdentifier, bankName: input.replacement.bankName,
          role: 'MEMBER', isContributor: true, rotationOrder, hasReceivedPot: member.hasReceivedPot,
          status: member.hasReceivedPot ? 'RECEIVED_POT' : 'WAITING', replacesMemberId: member.id,
        },
      });
      replacementId = rep.id;
      await audit(tx, { groupId: group.id, userId: actor.userId, action: 'MEMBER_REPLACED', entityType: 'GroupMember', entityId: rep.id, oldValue: { memberId, fullName: member.fullName }, newValue: { replacementId: rep.id, fullName: rep.fullName, rotationOrder }, reason: input.reason, ipAddress: actor.ip });
    } else if (!member.hasReceivedPot) {
      // seat removed without replacement: one fewer round is needed
      const last = await tx.round.findFirst({ where: { groupId: group.id, status: 'UPCOMING' }, orderBy: { roundNumber: 'desc' } });
      if (last) {
        await tx.round.delete({ where: { id: last.id } });
        await audit(tx, { groupId: group.id, userId: actor.userId, action: 'ROUND_STATUS_CHANGED', entityType: 'Round', entityId: last.id, oldValue: { roundNumber: last.roundNumber, status: 'UPCOMING' }, newValue: { removed: true }, reason: `Seat of exiting member ${member.fullName} removed`, ipAddress: actor.ip });
      }
    }
    const exit = await tx.memberExit.create({
      data: {
        groupId: group.id, memberId, settlement: input.settlement, hadReceivedPot: member.hasReceivedPot,
        contributionsPaid: q.balance.totals.contributions, potReceived: q.balance.totals.potReceived,
        remainingContributions: q.remainingContributions, arrears: q.balance.rounds.reduce((a, r) => a + r.outstanding, 0),
        lateFeesOwed: q.balance.lateFeeOutstanding, penalty: q.penalty, amountOwedByMember: q.amountOwedByMember,
        amountOwedToMember: q.amountOwedToMember, replacementMemberId: replacementId, reason: input.reason, recordedById: actor.userId,
      },
    });
    await audit(tx, { groupId: group.id, userId: actor.userId, action: 'MEMBER_EXITED', entityType: 'GroupMember', entityId: memberId, oldValue: { status: member.status }, newValue: exit, reason: input.reason, ipAddress: actor.ip });
    return { exit, quote: q };
  }, TX_OPTS);
}

// ---------------------------------------------------------------------------
// End of cycle settlement
// ---------------------------------------------------------------------------
export async function settlementPreview(group: Group) {
  const state = await loadGroupState(prisma, group.id, now());
  const allClosed = state.rounds.length > 0 && state.rounds.every((r) => r.status === 'COMPLETED');
  const recipients = state.members.filter((m) => m.isContributor && m.status !== 'EXITED');
  const pendingRefunds = state.entries.filter((e) => e.type === 'REFUND' && e.status === 'PENDING').reduce((a, e) => a + e.amount, 0);
  const distributable = state.fundBalance - pendingRefunds;
  const shares = distributable > 0 ? distributeEvenlyFor(distributable, recipients.map((r) => r.id)) : [];
  return {
    allRoundsClosed: allClosed,
    fundBalance: state.fundBalance,
    pendingRefunds,
    distributable,
    shares: shares.map((s) => ({ ...s, fullName: recipients.find((r) => r.id === s.memberId)?.fullName })),
    cycleValidation: state.cycleValidation,
  };
}

/** Create PENDING refund entries that distribute the remaining fund (late fees, penalties). */
export async function createSettlement(group: Group, actor: Actor) {
  if (group.status !== 'SETTLEMENT') throw conflict('Settlement is available after the last round is closed');
  const p = await settlementPreview(group);
  if (p.distributable <= 0) throw unprocessable('There is no surplus to distribute', p);
  return prisma.$transaction(async (tx) => {
    const created = [];
    for (const s of p.shares) {
      if (s.amount <= 0) continue;
      created.push(await tx.ledgerEntry.create({
        data: {
          groupId: group.id, memberId: s.memberId, type: 'REFUND', amount: s.amount, method: 'OTHER', paidAt: now(),
          recordedById: actor.userId, notes: 'End-of-cycle distribution of late fees / penalties held in the fund',
        },
      }));
    }
    await audit(tx, { groupId: group.id, userId: actor.userId, action: 'GROUP_SETTLEMENT_CREATED', entityType: 'Group', entityId: group.id, newValue: { distributable: p.distributable, shares: p.shares }, ipAddress: actor.ip });
    await notifyMembers(tx, {
      groupId: group.id, memberIds: p.shares.map((s) => s.memberId), type: 'GENERAL',
      title: 'End-of-cycle refund / चक्र अन्त्यको फिर्ता',
      body: 'Your share of the late fees collected during the cycle is ready to be paid out by the organizer.',
    });
    return created;
  }, TX_OPTS);
}

export async function completeGroup(group: Group, actor: Actor) {
  if (group.status !== 'SETTLEMENT') throw conflict('The group can be completed only after all rounds are closed');
  const state = await loadGroupState(prisma, group.id, now());
  const pending = state.entries.filter((e) => e.status === 'PENDING').length;
  if (pending) throw unprocessable(`${pending} transactions are still pending verification`);
  const openDisputes = await prisma.dispute.count({ where: { groupId: group.id, status: 'OPEN' } });
  if (openDisputes) throw unprocessable('Resolve all disputes first');
  if (!state.cycleValidation.isZero) throw unprocessable(state.cycleValidation.error!, state.cycleValidation);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.group.update({ where: { id: group.id }, data: { status: 'COMPLETED' } });
    await audit(tx, { groupId: group.id, userId: actor.userId, action: 'GROUP_COMPLETED', entityType: 'Group', entityId: group.id, oldValue: { status: 'SETTLEMENT' }, newValue: { status: 'COMPLETED', cycleValidation: state.cycleValidation }, ipAddress: actor.ip });
    return updated;
  }, TX_OPTS);
}
