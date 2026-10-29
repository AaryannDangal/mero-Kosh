/**
 * Notifications use an outbox pattern: rows are written inside the same DB
 * transaction as the business change, and emails are sent afterwards by
 * flushEmailOutbox() (called after commit and by the scheduler), so an email is
 * never sent for a change that was rolled back.
 */
import type { NotificationType } from '@prisma/client';
import type { Db } from '../lib/prisma';
import { prisma } from '../lib/prisma';
import { sendMail } from '../lib/mailer';

export interface NotifyInput {
  groupId: string;
  memberIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  roundId?: string | null;
  /** if set, `${dedupeKey}:${memberId}` is unique - the same reminder is never sent twice */
  dedupeKey?: string;
}

export async function notifyMembers(db: Db, n: NotifyInput): Promise<number> {
  if (!n.memberIds.length) return 0;
  const members = await db.groupMember.findMany({
    where: { id: { in: n.memberIds } },
    select: { id: true, userId: true, user: { select: { email: true, emailVerifiedAt: true, emailNotificationsEnabled: true } } },
  });
  let created = 0;
  for (const m of members) {
    const dedupeKey = n.dedupeKey ? `${n.dedupeKey}:${m.id}` : null;
    if (dedupeKey) {
      const exists = await db.notification.findUnique({ where: { dedupeKey } });
      if (exists) continue;
    }
    await db.notification.create({
      data: {
        groupId: n.groupId,
        userId: m.userId,
        memberId: m.id,
        roundId: n.roundId ?? null,
        type: n.type,
        title: n.title,
        body: n.body,
        dedupeKey,
        emailTo: m.user?.emailNotificationsEnabled && m.user.emailVerifiedAt ? m.user.email : null,
      },
    });
    created++;
  }
  return created;
}

export async function flushEmailOutbox(limit = 200): Promise<number> {
  const pending = await prisma.notification.findMany({
    where: {
      emailTo: { not: null },
      emailSentAt: null,
      user: { is: { emailNotificationsEnabled: true, emailVerifiedAt: { not: null } } },
    },
    take: limit,
    orderBy: { createdAt: 'asc' },
  });
  let sent = 0;
  for (const n of pending) {
    const ok = await sendMail(n.emailTo!, n.title, `${n.body}\n\n— Mero Kosh (record-keeping only; this app never handles money)`);
    if (ok) {
      await prisma.notification.update({ where: { id: n.id }, data: { emailSentAt: new Date() } });
      sent++;
    }
  }
  return sent;
}

/** Fire-and-forget flush used by routes after a successful commit. */
export function flushSoon(): void {
  setImmediate(() => {
    flushEmailOutbox().catch((e) => console.error('[outbox] flush failed', e));
  });
}
