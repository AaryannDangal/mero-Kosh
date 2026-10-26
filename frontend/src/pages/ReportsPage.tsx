import { useState } from 'react';
import { useGroup } from '../components/GroupLayout';
import { api, download } from '../lib/api';
import { useAction, useApi } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { date, npr, num } from '../lib/format';
import { Badge, ErrorText, Section, Spinner } from '../components/ui';
import { GroupedBarChart, HBarChart } from '../components/Charts';
import { CycleCheck } from './DashboardPage';
import type { CycleValidation, Member } from '../lib/types';

interface Charts {
  collectionRate: { round: number; expected: number; collected: number; cashBook: number; rate: number }[];
  arrears: { memberId: string; name: string; arrears: number; lateFeeOutstanding: number }[];
  payoutSchedule: { round: number; dueDate: string; recipient: string | null; payout: number | null; status: string }[];
  netPositions: { memberId: string; name: string; net: number }[];
  fundBalance: number;
  cycleValidation: CycleValidation;
}
interface Settlement { allRoundsClosed: boolean; fundBalance: number; pendingRefunds: number; distributable: number; shares: { memberId: string; fullName: string; amount: number }[] }

export function ReportsPage() {
  const { group, isReader, isManager, myMemberId, reloadGroup } = useGroup();
  const { t } = useI18n();
  const charts = useApi<Charts>(`/groups/${group.id}/reports/charts`);
  const members = useApi<{ members: Member[] }>(`/groups/${group.id}/members`);
  const settlement = useApi<Settlement>(isManager && group.status === 'SETTLEMENT' ? `/groups/${group.id}/settlement/preview` : null);
  const [stmtMember, setStmtMember] = useState(myMemberId);
  const exp = useAction();
  const act = useAction();
  const cur = group.currency;
  const dl = (path: string, name: string, fmt: 'csv' | 'pdf') => exp.run(() => download(`/groups/${group.id}/reports/${path}${path.includes('?') ? '&' : '?'}format=${fmt}`, `${name}.${fmt}`));
  const ExportRow = ({ label, path, name, show = true }: { label: string; path: string; name: string; show?: boolean }) => !show ? null : (
    <li className="flex items-center justify-between gap-2 py-2 text-sm">
      <span className="font-medium">{label}</span>
      <span className="flex gap-1">
        <button className="btn-secondary btn-sm" disabled={exp.busy} onClick={() => dl(path, name, 'csv')}>CSV</button>
        <button className="btn-secondary btn-sm" disabled={exp.busy} onClick={() => dl(path, name, 'pdf')}>PDF</button>
      </span>
    </li>
  );
  if (!charts.data) return <Spinner />;
  const c = charts.data;
  const visibleMembers = (members.data?.members ?? []).filter((m) => m.isContributor && (isReader || m.id === myMemberId));

  return (
    <div className="space-y-4">
      <CycleCheck status={group.status} cv={c.cycleValidation} currency={cur} />

      {isManager && group.status === 'SETTLEMENT' && settlement.data && (
        <Section title={`${t('SETTLEMENT')} / ${t('completeGroup')}`}>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>{t('fundBalance')}</span><b>{npr(settlement.data.fundBalance, cur)}</b></div>
            <div className="flex justify-between"><span>{t('PENDING')} {t('REFUND').toLowerCase()}</span><b>{npr(settlement.data.pendingRefunds, cur)}</b></div>
            {settlement.data.distributable > 0 && (
              <>
                <p className="text-stone-600">The fund still holds late fees/penalties. Distribute them as refunds, pay out off-app, then verify each refund with proof. / बाँकी रकम फिर्ता बाँड्नुहोस्।</p>
                <ul className="rounded-xl bg-stone-50 p-2">{settlement.data.shares.map((s) => <li key={s.memberId} className="flex justify-between"><span>{s.fullName}</span><span>{npr(s.amount, cur)}</span></li>)}</ul>
                <button className="btn-primary" disabled={act.busy} onClick={() => act.run(async () => { await api.post(`/groups/${group.id}/settlement`); settlement.reload(); charts.reload(); })}>{t('settleCycle')}</button>
              </>
            )}
            <button className="btn-primary" disabled={act.busy || !c.cycleValidation.isZero} onClick={() => act.run(async () => { await api.post(`/groups/${group.id}/complete`); await reloadGroup(); })}>✓ {t('completeGroup')}</button>
            <ErrorText error={act.error} />
          </div>
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('collectionRate')}>
          {c.collectionRate.length === 0 ? <p className="text-sm text-stone-500">—</p> : (
            <GroupedBarChart
              series={[{ name: t('expectedCollection'), color: '#d6d3d1' }, { name: t('collected'), color: '#2a8a72' }]}
              data={c.collectionRate.map((r) => ({ label: String(r.round), values: [r.expected, r.collected], note: `${num(r.rate)}%` }))}
              xLabel={(l) => `${t('round')} ${num(l)}`}
            />
          )}
        </Section>
        <Section title={t('netPositions')}>
          <HBarChart data={c.netPositions.map((n) => ({ label: n.name, value: n.net }))} />
          <p className="mt-3 text-xs text-stone-500">{t('netExplainer')}</p>
          <p className="mt-1 text-sm">Σ = <b>{npr(c.cycleValidation.sumOfNetPositions, cur)}</b> = {t('fundBalance')}</p>
        </Section>
        <Section title={t('arrearsChart')}>
          {c.arrears.every((a) => !a.arrears && !a.lateFeeOutstanding) ? <p className="text-sm text-emerald-700">✓ 0</p> : (
            <HBarChart colorPos="#dc2626" data={c.arrears.filter((a) => a.arrears || a.lateFeeOutstanding).map((a) => ({ label: a.name, value: a.arrears + a.lateFeeOutstanding, sub: a.lateFeeOutstanding ? `${t('lateFee')}: ${npr(a.lateFeeOutstanding, cur)}` : undefined }))} />
          )}
        </Section>
        <Section title={t('payoutSchedule')}>
          <ol className="relative ml-2 border-l-2 border-stone-200">
            {c.payoutSchedule.map((p) => (
              <li key={p.round} className="mb-3 ml-4">
                <span className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full ${p.status === 'COMPLETED' ? 'bg-emerald-500' : p.status === 'UPCOMING' ? 'bg-stone-300' : 'bg-amber-500'}`} />
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span><b>{t('round')} {num(p.round)}</b> · {date(p.dueDate)} · {p.recipient ?? (group.selectionMethod === 'BIDDING' ? `${t('bidding')}…` : '—')}</span>
                  <span className="flex items-center gap-2">{p.payout != null && npr(p.payout, cur)}<Badge status={p.status} /></span>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      </div>

      <Section title={t('exports')}>
        <ErrorText error={exp.error} />
        <ul className="divide-y divide-stone-100">
          <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="font-medium">{t('memberStatement')}</span>
            <span className="flex gap-1">
              <select className="input !w-auto !py-1" value={stmtMember} onChange={(e) => setStmtMember(e.target.value)}>
                {visibleMembers.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
              </select>
              <button className="btn-secondary btn-sm" disabled={exp.busy || !stmtMember} onClick={() => dl(`members/${stmtMember}`, 'member-statement', 'csv')}>CSV</button>
              <button className="btn-secondary btn-sm" disabled={exp.busy || !stmtMember} onClick={() => dl(`members/${stmtMember}`, 'member-statement', 'pdf')}>PDF</button>
            </span>
          </li>
          <ExportRow label={t('cycleReport')} path="cycle" name="cycle-report" />
          <ExportRow label={t('arrearsReport')} path="arrears" name="arrears" show={isReader} />
          <ExportRow label={t('lateReport')} path="late-payments" name="late-payments" show={isReader} />
          <ExportRow label={t('reconReport')} path="reconciliation" name="reconciliation" show={isReader} />
        </ul>
        <p className="mt-2 text-xs text-stone-500">{t('roundReport')}: {t('rounds')} → {t('round')} → CSV / PDF</p>
      </Section>
    </div>
  );
}
