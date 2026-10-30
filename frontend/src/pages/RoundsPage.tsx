import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGroup } from '../components/GroupLayout';
import { useApi } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { date, npr, num } from '../lib/format';
import { Badge, Empty, ProgressBar, Spinner, Button } from '../components/ui';
import type { Round } from '../lib/types';

export function RoundsPage() {
  const { group } = useGroup();
  const { t } = useI18n();
  const { data, refetch } = useApi<{ rounds: Round[] }>(`/groups/${group.id}/rounds`);
  const [showAll, setShowAll] = useState(false);
  if (!data) return <Spinner />;
  if (!data.rounds.length) return <Empty>{group.status === 'DRAFT' ? 'Rounds are created when the group starts. / समूह सुरु भएपछि चरणहरू बन्छन्।' : undefined}</Empty>;

  const rounds = data.rounds;
  const active = rounds.find((r) => r.status !== 'COMPLETED');
  const completed = rounds.filter((r) => r.status === 'COMPLETED');
  const recentCompleted = completed.slice(0, 2);
  const hiddenCompleted = completed.slice(2);

  return (
    <div className="space-y-6">
      {/* Active round — always visible */}
      {active && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-400">{t('activeRound') ?? 'Active Round'}</h2>
          <RoundCard r={active} group={group} t={t} date={date} npr={npr} num={num} Badge={Badge} ProgressBar={ProgressBar} />
        </div>
      )}

      {/* Most recent completed rounds — max 2 */}
      {recentCompleted.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-400">{t('recentRounds') ?? 'Recent Rounds'}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentCompleted.map((r) => (
              <RoundCard key={r.id} r={r} group={group} t={t} date={date} npr={npr} num={num} Badge={Badge} ProgressBar={ProgressBar} />
            ))}
          </div>
        </div>
      )}

      {/* Collapsible full history */}
      {hiddenCompleted.length > 0 && (
        <div>
          <button
            onClick={() => setShowAll((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border border-stone-200 bg-white px-4 py-3 text-left shadow-sm dark:border-stone-700 dark:bg-stone-900"
          >
            <span className="font-semibold text-stone-700 dark:text-stone-200">
              {showAll ? 'Hide History' : `View History (${hiddenCompleted.length} older round${hiddenCompleted.length > 1 ? 's' : ''})`}
            </span>
            <svg className={`h-5 w-5 text-stone-400 transition-transform ${showAll ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showAll && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {hiddenCompleted.map((r) => (
                <RoundCard key={r.id} r={r} group={group} t={t} date={date} npr={npr} num={num} Badge={Badge} ProgressBar={ProgressBar} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RoundCard({ r, group, t, date, npr, num, Badge, ProgressBar }: any) {
  const exp = r.expectedCollection ?? 0;
  const recipient = r.winnerName ?? r.plannedRecipient;
  return (
    <Link to={r.id} className={`card depth-card block transition hover:border-brand-500 ${r.status === 'UPCOMING' ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold">{t('round')} {num(r.roundNumber)}</div>
          <div className="text-xs text-stone-500">{r.periodLabel} · {t('dueDate')} {date(r.dueDate)}</div>
        </div>
        <Badge status={r.status} />
      </div>
      <div className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-stone-500">{t('winner')}</span><span className="font-semibold">{recipient ?? (r.selectionMethod === 'BIDDING' ? `${t('bidding')}…` : '—')}{!r.winnerName && recipient ? ' (planned)' : ''}</span></div>
        <div className="flex justify-between"><span className="text-stone-500">{t('payoutToWinner')}</span><span>{npr(r.payoutToWinner ?? r.fullPot ?? group.contributionAmount * group.memberCount, group.currency)}</span></div>
        {r.bidDiscount > 0 && <div className="flex justify-between"><span className="text-stone-500">{t('bidDiscount')}</span><span>{npr(r.bidDiscount, group.currency)}</span></div>}
        {r.status !== 'UPCOMING' && (
          <div className="pt-1">
            <div className="mb-1 flex justify-between text-xs text-stone-500"><span>{npr(r.collectedForRound ?? 0, group.currency)} / {npr(exp, group.currency)}</span>{r.reconciliationStatus !== 'NOT_STARTED' && <Badge status={r.reconciliationStatus} />}</div>
            <ProgressBar value={r.collectedForRound ?? 0} max={exp} tone={(r.collectedForRound ?? 0) >= exp ? 'green' : 'yellow'} />
          </div>
        )}
      </div>
    </Link>
  );
}