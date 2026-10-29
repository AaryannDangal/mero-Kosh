import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../lib/prisma';
import { hashPassword, signToken, verifyPassword } from '../lib/auth';
import { digestAuthToken, sendAuthLink } from '../lib/authTokens';
import { asyncHandler } from '../middleware/error';
import { validate } from '../middleware/validate';
import { loginLimiter } from '../middleware/rateLimit';
import { requireAuth } from '../middleware/auth';
import { AppError, conflict, unauthorized, unprocessable } from '../lib/errors';
import { authTokenSchema, deleteAccountSchema, emailSchema, googleSchema, loginSchema, passwordResetSchema, phone as phoneSchema, profileSchema, registerSchema } from './schemas';
import { config } from '../config';
import { audit } from '../lib/audit';
import { storage } from '../lib/storage';

export const authRouter = Router();

const publicUser = (u: { id: string; email: string | null; fullName: string; phone: string | null; preferredLanguage: string; emailVerifiedAt?: Date | null; emailNotificationsEnabled?: boolean; googleId?: string | null; passwordHash?: string | null }) => ({
  id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, preferredLanguage: u.preferredLanguage,
  emailVerified: !!u.emailVerifiedAt, emailNotificationsEnabled: !!u.emailNotificationsEnabled, hasGoogle: !!u.googleId, hasPassword: !!u.passwordHash,
});

authRouter.post('/register', loginLimiter, validate(registerSchema), asyncHandler(async (req, res) => {
  const { email, password, fullName, phone, preferredLanguage } = req.body;
  if (email && await prisma.user.findUnique({ where: { email } })) throw conflict('An account with this email already exists');
  if (await prisma.user.findUnique({ where: { phone } })) throw conflict('An account with this phone number already exists');
  const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(password), fullName, phone, preferredLanguage } });
  if (user.email) await sendAuthLink(user.id, user.email, 'VERIFY_EMAIL');
  await audit(prisma, { userId: user.id, action: 'MEMBER_JOINED', entityType: 'User', entityId: user.id, newValue: { accountCreated: true }, ipAddress: req.ip });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

authRouter.post('/login', loginLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;
  const byEmail = identifier.includes('@');
  const rawTrimmed = identifier.trim();
  const normalizedPhone = byEmail ? null : phoneSchema.safeParse(identifier).data ?? null;
  const user = byEmail
    ? (await prisma.user.findUnique({ where: { email: identifier.toLowerCase() } }))
    : await prisma.user.findFirst({
        where: {
          OR: [
            { phone: rawTrimmed },
            ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
            { phone: rawTrimmed.replace(/\s+/g, '') },
          ],
        },
      });
  // constant-ish time: always run bcrypt
  const ok = await verifyPassword(password, user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!user || !user.passwordHash || !ok) throw unauthorized('Invalid email/phone or password');
  res.json({ token: signToken(user), user: publicUser(user) });
}));

authRouter.get('/config', (_req, res) => {
  res.json({ googleClientId: config.googleClientId || null, emailConfigured: !!config.smtp.host });
});

authRouter.post('/google', loginLimiter, validate(googleSchema), asyncHandler(async (req, res) => {
  if (!config.googleClientId) throw new AppError(501, 'NOT_CONFIGURED', 'Google login is not configured on this server');
  const client = new OAuth2Client(config.googleClientId);
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: req.body.credential, audience: config.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw unauthorized('Invalid Google credential');
  }
  if (!payload?.email || !payload.email_verified) throw unauthorized('Google account email is not verified');
  const email = payload.email.toLowerCase();
  const phone = req.body.phone ?? null;
  let user = await prisma.user.findFirst({ where: { OR: [{ googleId: payload.sub }, { email }] } });
  if (!user) {
    if (!phone) throw new AppError(400, 'PHONE_REQUIRED', 'A phone number is required to create an account');
    if (await prisma.user.findUnique({ where: { phone } })) throw conflict('An account with this phone number already exists');
    user = await prisma.user.create({ data: { email, emailVerifiedAt: new Date(), phone, googleId: payload.sub, fullName: payload.name ?? email.split('@')[0] } });
  } else if (!user.googleId) {
    user = await prisma.user.update({ where: { id: user.id }, data: { googleId: payload.sub, emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });
  } else if (!user.emailVerifiedAt) {
    user = await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }
  if (!user.phone && phone) {
    if (await prisma.user.findUnique({ where: { phone } })) throw conflict('An account with this phone number already exists');
    user = await prisma.user.update({ where: { id: user.id }, data: { phone } });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  res.json({ user: publicUser(user) });
}));

authRouter.post('/delete-account', requireAuth, loginLimiter, validate(deleteAccountSchema), asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const typedIdentifier = req.body.identifier.trim();
  const identifierMatches = (user.email && typedIdentifier.toLowerCase() === user.email.toLowerCase())
    || (user.phone && typedIdentifier === user.phone);
  if (!identifierMatches) throw unauthorized('Enter the email address or phone number on your account to confirm deletion');
  if (user.passwordHash) {
    if (!req.body.password || !await verifyPassword(req.body.password, user.passwordHash)) throw unauthorized('The password is incorrect');
  } else if (user.googleId) {
    if (!req.body.googleCredential || !config.googleClientId) throw unauthorized('Confirm account deletion with Google sign-in');
    try {
      const ticket = await new OAuth2Client(config.googleClientId).verifyIdToken({ idToken: req.body.googleCredential, audience: config.googleClientId });
      if (ticket.getPayload()?.sub !== user.googleId) throw unauthorized('Sign in with the Google account linked to this profile');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unauthorized('Google confirmation is invalid or expired');
    }
  } else {
    throw unprocessable('This account cannot be re-authenticated. Contact support to complete deletion.');
  }

  const organizerSeats = await prisma.groupMember.findMany({
    where: { userId: user.id, role: 'ORGANIZER', group: { is: { deletedAt: null, status: { not: 'COMPLETED' } } } },
    select: { id: true, groupId: true, group: { select: { id: true, name: true, createdById: true, rulesConfirmedById: true } } },
  });
  const transfers = [] as { previousMemberId: string; groupId: string; groupName: string; createdById: string; rulesConfirmedById: string | null; nextMemberId: string; nextUserId: string }[];
  for (const seat of organizerSeats) {
    const replacement = await prisma.groupMember.findFirst({ where: { groupId: seat.groupId, role: 'CO_ORGANIZER', userId: { not: null } }, select: { id: true, userId: true } });
    if (!replacement?.userId) throw conflict(`Add a linked co-organizer to "${seat.group.name}" before deleting your account, so the group keeps an active organizer.`);
    transfers.push({ previousMemberId: seat.id, groupId: seat.group.id, groupName: seat.group.name, createdById: seat.group.createdById, rulesConfirmedById: seat.group.rulesConfirmedById, nextMemberId: replacement.id, nextUserId: replacement.userId });
  }

  const linkedMembers = await prisma.groupMember.findMany({ where: { userId: user.id }, select: { id: true, profilePhotoPath: true } });
  const photoKeys = linkedMembers.map((member) => member.profilePhotoPath).filter((key): key is string => !!key);
  await prisma.$transaction(async (tx) => {
    for (const transfer of transfers) {
      await tx.groupMember.update({ where: { id: transfer.previousMemberId }, data: { role: 'MEMBER' } });
      await tx.groupMember.update({ where: { id: transfer.nextMemberId }, data: { role: 'ORGANIZER' } });
      await tx.group.update({
        where: { id: transfer.groupId },
        data: { createdById: transfer.nextUserId, ...(transfer.rulesConfirmedById === user.id ? { rulesConfirmedById: transfer.nextUserId } : {}) },
      });
      await audit(tx, {
        groupId: transfer.groupId, action: 'ORGANIZER_TRANSFERRED', entityType: 'Group', entityId: transfer.groupId,
        oldValue: { organizerMemberId: transfer.previousMemberId }, newValue: { organizerMemberId: transfer.nextMemberId },
        reason: 'Organizer account deletion',
      });
    }
    await tx.groupMember.updateMany({
      where: { userId: user.id },
      data: { userId: null, fullName: 'Former member', phone: null, email: null, paymentIdentifier: null, bankName: null, profilePhotoPath: null },
    });
    await tx.notification.deleteMany({ where: { userId: user.id } });
    await audit(tx, { action: 'ACCOUNT_DELETED', entityType: 'User', entityId: user.id, newValue: { financialHistoryRetained: true }, ipAddress: req.ip });
    await tx.user.delete({ where: { id: user.id } });
  });
  const removals = await Promise.allSettled(photoKeys.map((key) => storage.remove(key)));
  if (removals.some((result) => result.status === 'rejected')) console.error('[account deletion] one or more profile images could not be removed');
  res.status(204).end();
}));

authRouter.patch('/me', requireAuth, validate(profileSchema), asyncHandler(async (req, res) => {
  const current = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { email: true, emailVerifiedAt: true, emailNotificationsEnabled: true } });
  const changingEmail = Object.hasOwn(req.body, 'email') && req.body.email !== current.email;
  if (changingEmail && req.body.email && await prisma.user.findUnique({ where: { email: req.body.email }, select: { id: true } })) throw conflict('An account with this email already exists');
  if (req.body.emailNotificationsEnabled === true && (changingEmail || !current.email || !current.emailVerifiedAt)) {
    throw unprocessable('Verify an email address before enabling email notifications');
  }
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      ...req.body,
      ...(changingEmail ? { emailVerifiedAt: null, emailNotificationsEnabled: false } : {}),
    },
  });
  if (req.body.emailNotificationsEnabled === false || changingEmail) {
    await prisma.notification.updateMany({ where: { userId: req.user!.id, emailSentAt: null }, data: { emailTo: null } });
  }
  if (changingEmail && user.email) await sendAuthLink(user.id, user.email, 'VERIFY_EMAIL');
  res.json({ user: publicUser(user) });
}));

authRouter.post('/verify-email/request', requireAuth, loginLimiter, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (user.email && !user.emailVerifiedAt) await sendAuthLink(user.id, user.email, 'VERIFY_EMAIL');
  res.json({ ok: true });
}));

authRouter.post('/verify-email/confirm', validate(authTokenSchema), asyncHandler(async (req, res) => {
  const token = await prisma.authToken.findFirst({ where: { tokenHash: digestAuthToken(req.body.token), purpose: 'VERIFY_EMAIL', usedAt: null, expiresAt: { gt: new Date() } } });
  if (!token) throw unauthorized('This verification link is invalid or expired');
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.authToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw unauthorized('This verification link is invalid or expired');
    await tx.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } });
  });
  res.json({ ok: true });
}));

authRouter.post('/password-reset/request', loginLimiter, validate(emailSchema), asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (user?.email && user.emailVerifiedAt && user.passwordHash) await sendAuthLink(user.id, user.email, 'RESET_PASSWORD');
  res.json({ ok: true, message: 'If a verified account exists for that email, a reset link will be sent.' });
}));

authRouter.post('/password-reset/confirm', loginLimiter, validate(passwordResetSchema), asyncHandler(async (req, res) => {
  const token = await prisma.authToken.findFirst({ where: { tokenHash: digestAuthToken(req.body.token), purpose: 'RESET_PASSWORD', usedAt: null, expiresAt: { gt: new Date() }, user: { is: { passwordHash: { not: null }, emailVerifiedAt: { not: null } } } } });
  if (!token) throw unauthorized('This reset link is invalid or expired');
  const passwordHash = await hashPassword(req.body.password);
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.authToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw unauthorized('This reset link is invalid or expired');
    await tx.user.update({ where: { id: token.userId }, data: { passwordHash, tokenVersion: { increment: 1 } } });
    await tx.authToken.updateMany({ where: { userId: token.userId, purpose: 'RESET_PASSWORD', usedAt: null }, data: { usedAt: new Date() } });
  });
  res.json({ ok: true });
}));
