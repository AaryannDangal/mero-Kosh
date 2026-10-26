/**
 * Daily reminder job:
 *  - DUE_SOON  : within 3 days before the due date (sent once per round)
 *  - DUE_TODAY : on the due date
 *  - OVERDUE   : after the grace period has passed (sent once per round)
 * Deduplication keys make the job idempotent - it is safe to run many times a day.
 */
import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { now } from '../lib/clock';
import { dayNumber } from '../domain/calculations';
import { formatNpr } from '../domain/money';
import { loadGroupState } from '../services/state';
import { flushEmailOutbox, notifyMembers } from '../services/notifications';
import { config } from '../config';

export async function runReminders(asOf: Date = now(), groupId?: string) {
  const groups = await prisma.group.findMany({ where: { status: { in: ['ACTIVE', 'SETTLEMENT'] }, deletedAt: null, ...(groupId ? { id: groupId } : {}) } });
  const counts = { dueSoon: 0, dueToday: 0, overdue: 0, emailsSent: 0 };
  for (const g of groups) {
    const s = await loadGroupState(prisma, g.id, asOf);
    const today = dayNumber(asOf);
    for (const b of s.balances.values()) {
      for (const rs of b.rounds) {
        if (rs.outstanding <= 0) continue;
        const due = dayNumber(rs.dueDate);
        const amount = formatNpr(rs.outstanding, g.currency);
        const date = rs.dueDate.toISOString().slice(0, 10);
        if (today >= due - 3 && today < due) {
          counts.dueSoon += await notifyMembers(prisma, {
            groupId: g.id, memberIds: [b.memberId], type: 'DUE_SOON', roundId: rs.roundId, dedupeKey: `due-soon:${rs.roundId}`,
            title: `Reminder: ${amount} due on ${date} / सम्झना: ${date} मा भुक्तानी`,
            body: `Your contribution of ${amount} for round ${rs.roundNumber} of "${g.name}" is due on ${date}. Pay the member/organizer directly and upload the proof in Mero Kosh.\n\nतपाईंको "${g.name}" चरण ${rs.roundNumber} को योगदान ${date} मा तिर्नुपर्नेछ।`,
          });
        } else if (today === due) {
          counts.dueToday += await notifyMembers(prisma, {
            groupId: g.id, memberIds: [b.memberId], type: 'DUE_TODAY', roundId: rs.roundId, dedupeKey: `due-today:${rs.roundId}`,
            title: `Due today: ${amount} / आज भुक्तानी गर्नुपर्ने`,
            body: `Your contribution of ${amount} for round ${rs.roundNumber} of "${g.name}" is due today.\n\nतपाईंको योगदान आज तिर्नुपर्ने छ।`,
          });
        } else if (rs.status === 'OVERDUE') {
          counts.overdue += await notifyMembers(prisma, {
            groupId: g.id, memberIds: [b.memberId], type: 'OVERDUE', roundId: rs.roundId, dedupeKey: `overdue:${rs.roundId}`,
            title: `Overdue: ${amount} for round ${rs.roundNumber} / म्याद नाघेको भुक्तानी`,
            body: `Your contribution of ${amount} for round ${rs.roundNumber} of "${g.name}" is overdue (grace period of ${g.gracePeriodDays} days has passed). Late fees may apply: ${formatNpr(rs.lateFeeAssessed, g.currency)} so far.\n\nतपाईंको भुक्तानी म्याद नाघिसकेको छ। ढिलो शुल्क लाग्न सक्छ।`,
          });
        }
      }
    }
  }
  counts.emailsSent = await flushEmailOutbox();
  return counts;
}

export function startScheduler() {
  if (!config.enableScheduler || config.isTest) return null;
  const task = cron.schedule(config.reminderCron, () => {
    runReminders().then((c) => console.log('[reminders]', c)).catch((e) => console.error('[reminders] failed', e));
  }, { timezone: config.timezone });
  console.log(`[reminders] scheduled "${config.reminderCron}" (${config.timezone})`);
  return task;
}
