import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGroup } from '../components/GroupLayout';
import { useApi } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { date, npr, num, whatsappLink } from '../lib/format';
import { Alert, Badge, Empty, ProgressBar, Section, Spinner, Stat } from '../components/ui';
import { PaymentModal, type PaymentDefaults } from '../components/PaymentModal';
import type { Balance, CycleValidation, Entry, Member, Round } from '../lib/types';

interface Dashboard {
  currentRound: null | {
    id: string; roundNumber: number; periodLabel: string; dueDate: string; status: string; biddingStatus: string; fullPot: number | null;
    bidDiscount: number; payoutToWinner: number | null; winnerName: string | null; expected: number; collected: number; pending: number;
    outstanding: number; paidCount: number; contributorCount: number; payoutRecorded: boolean;
  };
  totals: { expected: number; collected: number; outstanding: number; totalArrears: number; fundBalance: number };
  overdueMembers: { memberId: string; fullName: string; overdueAmount: number; arrears: number; lateFeeOutstanding: number; phone?: string | null }[];
  nextPayout: { roundNumber: number; dueDate: string; recipient: string | null; amount: number } | null;
  roundsCompleted: number; roundsTotal: number; cycleValidation: CycleValidation; pendingVerifications: number; openDisputes: number;
}

/** Σ net ≠ 0 is normal mid-cycle (the fund holds money). It is only an error once the cycle is over. */
export function CycleCheck({ status, cv, currency }: { status: string; cv: CycleValidation; currency: string }) {
  const { t } = useI18n();
  if (status !== 'SETTLEMENT' && status !== 'COMPLETED') return null;
  if (cv.isZero) return <Alert tone="green">{t('zeroSumOk')}</Alert>;
  return (
    <Alert tone="red" title={`Validation error · Σ ${t('netPosition')} = ${npr(cv.sumOfNetPositions, currency)}`}>
      {cv.error}
    </Alert>
  );
}

export function DashboardPage() {
  const g = useGroup();
  const { group, isReader, isManager, myMemberId } = g;
  const { t } = useI18n();
  const dash = useApi<Dashboard>(`/groups/${group.id}/dashboard`);
  const me = useApi<{ member: Member; balance?: Balance; history: Entry[]; currentRoundId: string | null }>(`/groups/${group.id}/me`);
  const members = useApi<{ members: Member[] }>(`/groups/${group.id}/members`);
  const rounds = useApi<{ rounds: Round[] }>(`/groups/${group.id}/rounds`);
  const [pay, setPay] = useState<PaymentDefaults | null>(null);
  const reloadAll = () => { dash.reload(); me.reload(); rounds.reload(); members.reload(); };

  if (!dash.data || !me.data) return <Spinner />;
  const d = dash.data;
  const cr = d.currentRound;
  const cur = group.currency;
  const isContributor = me.data.member.isContributor;
  const b = me.data.balance;

  return (
    <div className="space-y-4">
      {group.status === 'DRAFT' && (
        <Alert tone="blue" title="Setup / सेटअप">
          <ol className="ml-4 list-decimal space-y-0.5">
            <li><Link className="underline" to="members">{t('addMember')}</Link> ({num(members.data?.members.filter((m) => m.isContributor).length ?? 0)}/{num(group.memberCount)})</li>
            <li><Link className="underline" to="rules">{t('confirmRules')}</Link> {group.rulesConfirmedAt && '✓'}</li>
            <li><Link className="underline" to="rules">{t('startGroup')}</Link></li>
          </ol>
        </Alert>
      )}
      <CycleCheck status={group.status} cv={d.cycleValidation} currency={cur} />

      {/* -------- member's own dashboard -------- */}
      {isContributor && b && (
        <Section title={`${t('myDashboard')} · ${me.data.member.fullName}`}
          action={group.status !== 'DRAFT' && group.status !== 'COMPLETED' && (
            <div className="flex flex-wrap items-center gap-2">
              {!isManager && group.selectionMethod === 'ADMIN_SELECTION' && cr && (
                <Link to={`rounds/${cr.id}`} className="btn-secondary btn-sm">{t('potRequestsAction')}</Link>
              )}
              <button className="btn-primary btn-sm" onClick={() => setPay(b.nextDue ? { memberId: myMemberId, roundId: b.nextDue.roundId, amount: b.nextDue.outstanding || undefined } : { memberId: myMemberId })}>
                📎 {t('uploadProof')}
              </button>
            </div>
          )}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('nextPayment')} value={b.nextDue ? npr(b.nextDue.outstanding, cur) : '—'} sub={b.nextDue ? `${t('round')} ${num(b.nextDue.roundNumber)} · ${t('dueDate')} ${date(b.nextDue.dueDate)}` : undefined}
              tone={b.paymentStatus === 'OVERDUE' ? 'red' : b.paymentStatus === 'PAID' ? 'green' : 'yellow'} />
            <Stat label={t('paymentStatus')} value={<Badge status={b.paymentStatus} />} sub={b.pendingAmount ? `${t('PENDING')}: ${npr(b.pendingAmount, cur)}` : undefined} />
            <Stat label={t('potStatus')} value={<Badge status={b.potStatus} />} />
            <Stat label={t('netPosition')} value={npr(b.totals.netPosition, cur)} tone={b.totals.netPosition < 0 ? 'red' : 'green'} sub={t('netExplainer')} />
            <Stat label={t('totalContributions')} value={npr(b.totals.contributions, cur)} />
            <Stat label={t('totalDiscounts')} value={npr(b.totalDiscountCredits, cur)} />
            <Stat label={t('totalLateFees')} value={npr(b.totals.lateFeesPaid, cur)} sub={b.lateFeeOutstanding ? `${t('outstanding')}: ${npr(b.lateFeeOutstanding, cur)}` : undefined} tone={b.lateFeeOutstanding ? 'red' : undefined} />
            <Stat label={t('totalPot')} value={npr(b.totals.potReceived, cur)} />
            <Stat label={t('remainingContributions')} value={npr(b.remainingContributions, cur)} />
            <Stat label={t('arrears')} value={npr(b.arrears, cur)} tone={b.arrears > 0 ? 'red' : 'green'} />
          </div>
          <h3 className="mb-2 mt-4 text-sm font-bold">{t('paymentHistory')}</h3>
          {me.data.history.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-stone-100">
              {me.data.history.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">#{num(e.seq)} {t(e.type)}</div>
                    <div className="text-xs text-stone-500">{date(e.paidAt)} · {t(e.method)}{e.rejectedReason ? ` · ${e.rejectedReason}` : ''}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold">{npr(e.amount, cur)}</div>
                    <Badge status={e.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link to="ledger" className="mt-2 inline-block text-sm font-semibold text-brand-600">{t('ledger')} →</Link>
        </Section>
      )}

      {/* -------- group overview (shared figures) -------- */}
      {cr ? (
        <Section title={`${t('currentRound')}: ${t('round')} ${num(cr.roundNumber)} · ${cr.periodLabel}`} action={<Link to={`rounds/${cr.id}`} className="btn-secondary btn-sm">{t('round')} →</Link>}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge status={cr.status} />
            {cr.biddingStatus !== 'NOT_APPLICABLE' && <Badge status={cr.biddingStatus} label={`${t('bidding')}: ${t(cr.biddingStatus)}`} />}
            <span className="text-stone-500">{t('dueDate')}: {date(cr.dueDate)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('totalExpected')} value={npr(cr.expected, cur)} />
            <Stat label={t('collected')} value={npr(cr.collected, cur)} tone="green" sub={cr.pending ? `+ ${npr(cr.pending, cur)} ${t('PENDING').toLowerCase()}` : undefined} />
            <Stat label={t('outstanding')} value={npr(cr.outstanding, cur)} tone={cr.outstanding ? 'red' : 'green'} />
            <Stat label={t('winner')} value={cr.winnerName ?? '—'} sub={cr.payoutToWinner != null ? `${t('payoutToWinner')}: ${npr(cr.payoutToWinner, cur)}` : undefined} />
          </div>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-stone-500"><span>{t('PAID')}: {num(cr.paidCount)}/{num(cr.contributorCount)}</span><span>{cr.expected ? num(Math.round((cr.collected / cr.expected) * 100)) : 0}%</span></div>
            <ProgressBar value={cr.collected} max={cr.expected} tone={cr.collected >= cr.expected ? 'green' : 'yellow'} />
          </div>
        </Section>
      ) : group.status === 'ACTIVE' && <Empty />}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {d.nextPayout && <Stat label={t('nextPayout')} value={npr(d.nextPayout.amount, cur)} sub={`${t('round')} ${num(d.nextPayout.roundNumber)} · ${d.nextPayout.recipient ?? (group.selectionMethod === 'BIDDING' ? t('bidding') : '—')} · ${date(d.nextPayout.dueDate)}`} />}
        <Stat label={t('fundBalance')} value={npr(d.totals.fundBalance, cur)} />
        <Stat label={t('rounds')} value={`${num(d.roundsCompleted)}/${num(d.roundsTotal || group.memberCount)}`} sub={t('COMPLETED')} />
        {isReader && <Stat label={t('arrears')} value={npr(d.totals.totalArrears, cur)} tone={d.totals.totalArrears ? 'red' : 'green'} />}
        {isManager && (
          <Link to="ledger?status=PENDING" className="contents">
            <Stat label={t('pendingVerifications')} value={num(d.pendingVerifications)} tone={d.pendingVerifications ? 'yellow' : 'green'} />
          </Link>
        )}
        {isReader && <Link to="ledger#disputes" className="contents"><Stat label={t('openDisputes')} value={num(d.openDisputes)} tone={d.openDisputes ? 'red' : 'green'} /></Link>}
      </div>

      {d.overdueMembers.length > 0 && (
        <Section title={`${t('overdueMembers')} (${num(d.overdueMembers.length)})`}>
          <ul className="divide-y divide-stone-100">
            {d.overdueMembers.map((m) => {
              const msg = `Namaste ${m.fullName}, ${group.name}: ${t('round')} ${cr?.roundNumber ?? ''} — ${npr(m.overdueAmount + m.lateFeeOutstanding, cur)} ${t('outstanding').toLowerCase()}. ${t('uploadProof')} 🙏`;
              const wa = isManager ? whatsappLink(m.phone, msg) : null;
              return (
                <li key={m.memberId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <div className="font-medium">{m.fullName} <Badge status="OVERDUE" /></div>
                    <div className="text-xs text-stone-500">{t('arrears')}: {npr(m.overdueAmount, cur)} · {t('lateFee')}: {npr(m.lateFeeOutstanding, cur)}</div>
                  </div>
                  <div className="flex gap-1">
                    {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">💬 {t('remind')}</a>}
                    {isManager && <button className="btn-secondary btn-sm" onClick={() => setPay({ memberId: m.memberId })}>{t('recordPayment')}</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {pay && members.data && rounds.data && (
        <PaymentModal open onClose={() => setPay(null)} onDone={reloadAll} groupId={group.id} isManager={isManager} myMemberId={myMemberId}
          defaults={pay} members={members.data.members} rounds={rounds.data.rounds} currency={cur} />
      )}
    </div>
  );
}
