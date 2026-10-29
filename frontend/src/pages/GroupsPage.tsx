import { Link } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { npr, date } from '../lib/format';
import { Badge, Empty, Spinner } from '../components/ui';
import type { Group, Role } from '../lib/types';

type G = Group & { myRole: Role; myMemberId: string; myStatus: string };

export function GroupsPage() {
  const { t } = useI18n();
  const { data, loading } = useApi<{ groups: G[] }>('/groups');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('myGroups')}</h1>
        <div>
          <Link to="/groups/new" className="btn-primary">+ {t('createGroup')}</Link>
        </div>
      </div>
      {loading ? <Spinner /> : !data?.groups.length ? <Empty>{t('noGroups')}</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.groups.map((g) => (
            <Link key={g.id} to={`/groups/${g.id}`} className="card block transition hover:border-brand-500 hover:shadow">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-bold">{g.name}</h2>
                <Badge status={g.status} />
              </div>
              <div className="mt-2 text-sm text-stone-600">{npr(g.contributionAmount, g.currency)} × {g.memberCount} · {t(g.frequency)}</div>
              <div className="text-xs text-stone-500">{t(g.selectionMethod)} · {t('startDate')}: {date(g.startDate)}</div>
              <div className="mt-2 flex flex-wrap gap-1"><Badge tone="blue" label={t(g.myRole)} />{g.myStatus && <Badge status={g.myStatus} />}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
