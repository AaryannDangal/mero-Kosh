import { createHash, randomBytes } from 'node:crypto';
import type { AuthTokenPurpose } from '@prisma/client';
import { prisma } from './prisma';
import { config } from '../config';
import { sendMail } from './mailer';

export const digestAuthToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function sendAuthLink(userId: string, email: string, purpose: AuthTokenPurpose) {
  const token = randomBytes(32).toString('base64url');
  await prisma.$transaction(async (tx) => {
    await tx.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    await tx.authToken.create({
      data: {
        userId,
        purpose,
        tokenHash: digestAuthToken(token),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
  });
  const isVerify = purpose === 'VERIFY_EMAIL';
  const path = isVerify ? `/verify-email?token=${token}` : `/reset-password?token=${token}`;
  const subject = isVerify ? 'Verify your Mero Kosh email' : 'Reset your Mero Kosh password';
  const text = isVerify
    ? `Verify your email within 30 minutes: ${config.appUrl.replace(/\/$/, '')}${path}`
    : `Reset your password within 30 minutes: ${config.appUrl.replace(/\/$/, '')}${path}`;
  return sendMail(email, subject, text);
}
