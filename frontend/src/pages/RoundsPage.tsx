import { Link } from 'react-router-dom';
import { useGroup } from '../components/GroupLayout';
import { useApi } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { date, npr, num } from '../lib/format';
import { Badge, Empty, ProgressBar, Spinner } from '../components/ui';
import type { Round } from '../lib/types';

export function RoundsPage() {
  const { group } = useGroup();
  const { t } = useI18n();
  const { data } = useApi<{ rounds: Round[] }>(`/groups/${group.id}/rounds`);
  if (!data) return <Spinner />;
  if (!data.rounds.length) return <Empty>{group.status === 'DRAFT' ? 'Rounds are created when the group starts. / समूह सुरु भएपछि चरणहरू बन्छन्।' : undefined}</Empty>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.rounds.map((r) => {
        const exp = r.expectedCollection ?? 0;
        const recipient = r.winnerName ?? r.plannedRecipient;
        return (
          <Link key={r.id} to={r.id} className={`card depth-card block transition hover:border-brand-500 ${r.status === 'UPCOMING' ? 'opacity-70' : ''}`}>
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
      })}
    </div>
  );
}
