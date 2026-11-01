import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGroup } from '../components/GroupLayout';
import { useApi, useAction } from '../lib/hooks';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { date, npr, num } from '../lib/format';
import { Badge, Empty, ProgressBar, Spinner } from '../components/ui';
import type { Round } from '../lib/types';

const VISIBLE_ROUNDS = 4;
const OPEN_STATUSES = ['COLLECTING', 'PAYOUT_PENDING', 'DISPUTED'];

export function RoundsPage() {
  const { group, isManager } = useGroup();
  const { t } = useI18n();
  const { data, reload } = useApi<{ rounds: Round[] }>(`/groups/${group.id}/rounds`);
  const [showAll, setShowAll] = useState(false);
  const createNext = useAction();

  if (!data) return <Spinner />;
  if (!data.rounds.length) {
    return <Empty>{group.status === 'DRAFT' ? 'Rounds are created when the group starts. / समूह सुरु भएपछि चरणहरू बन्छन्।' : undefined}</Empty>;
  }

  // Newest first — the page previously showed the oldest rounds and hid the new ones.
  const rounds = [...data.rounds].sort((a, b) => b.roundNumber - a.roundNumber);
  const visible = rounds.slice(0, VISIBLE_ROUNDS);
  const older = rounds.slice(VISIBLE_ROUNDS);
  const hasOpenRound = rounds.some((r) => OPEN_STATUSES.includes(r.status));
  const canCreateNext = isManager && !hasOpenRound && group.status !== 'COMPLETED' && group.status !== 'DRAFT';

  const onToggleHistory = () => {
    const next = !showAll;
    setShowAll(next);
    if (next) {
      // Let the user jump straight into the older rounds.
      requestAnimationFrame(() => document.getElementById('older-rounds')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Next round recovery / manual start */}
      {canCreateNext && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {group.status === 'SETTLEMENT'
              ? 'This group is in Settlement and has no open round. Start the next round to continue.'
              : 'No round is open right now. Start the next round to continue collecting.'}
          </p>
          {createNext.error && <p className="mt-1 text-sm text-red-700 dark:text-red-300">{createNext.error}</p>}
          <button
            type="button"
            disabled={createNext.busy}
            onClick={() => createNext.run(async () => { await api.post(`/groups/${group.id}/rounds`, {}); await reload(); })}
            className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
          >
            {createNext.busy ? 'Starting…' : t('createNextRound')}
          </button>
        </div>
      )}

      {/* Newest rounds — always visible, most recent first */}
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-400">
          {hasOpenRound && visible[0] && OPEN_STATUSES.includes(visible[0].status) ? (t('activeRound') ?? 'Active round') : (t('recentRounds') ?? 'Newest rounds')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((r) => (
            <RoundCard key={r.id} r={r} group={group} t={t} />
          ))}
        </div>
      </div>

      {/* Older rounds — collapsed by default so phones stay clean */}
      {older.length > 0 && (
        <div>
          <button
            type="button"
            onClick={onToggleHistory}
            aria-expanded={showAll}
            className="flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-brand-500 dark:border-stone-700 dark:bg-stone-900"
          >
            <span className="font-semibold text-stone-700 dark:text-stone-200">
              {showAll
                ? 'Hide earlier rounds'
                : `View all previous rounds (${older.length} earlier)`}
            </span>
            <svg className={`h-5 w-5 text-stone-400 transition-transform ${showAll ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showAll && (
            <div id="older-rounds" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {older.map((r) => (
                <RoundCard key={r.id} r={r} group={group} t={t} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RoundCard({ r, group, t }: { r: Round; group: ReturnType<typeof useGroup>['group']; t: ReturnType<typeof useI18n>['t'] }) {
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
