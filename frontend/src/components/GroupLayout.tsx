import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { Badge, ErrorText, Spinner } from './ui';
import { isManagerRole, type Group, type Role } from '../lib/types';

export interface GroupCtx {
  group: Group;
  myRole: Role;
  myMemberId: string;
  rules: { en: string[]; ne: string[] };
  isManager: boolean;
  isReader: boolean; // manager or viewer: may see group-wide private data
  reloadGroup: () => Promise<void>;
}
export const useGroup = () => useOutletContext<GroupCtx>();

export function GroupLayout() {
  const { groupId } = useParams();
  const { t } = useI18n();
  const { data, error, reload } = useApi<{ group: Group; myRole: Role; myMemberId: string; rules: { en: string[]; ne: string[] } }>(`/groups/${groupId}`);
  if (error) return <ErrorText error={error.message} />;
  if (!data) return <Spinner />;
  const isManager = isManagerRole(data.myRole);
  const isReader = isManager || data.myRole === 'VIEWER';
  const tabs = [
    { to: '', label: t('dashboard'), end: true },
    { to: 'rounds', label: t('rounds') },
    { to: 'ledger', label: t('ledger') },
    { to: 'members', label: t('members') },
    { to: 'reports', label: t('reports') },
    { to: 'rules', label: t('rules') },
    ...(isReader ? [{ to: 'audit', label: t('audit') }] : []),
    ...(isManager ? [{ to: 'settings', label: t('settings') }] : []),
  ];
  const ctx: GroupCtx = { ...data, isManager, isReader, reloadGroup: reload };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold sm:text-2xl">{data.group.name}</h1>
        <Badge status={data.group.status} />
        <Badge tone="blue" label={t(data.myRole)} />
      </div>
      <nav className="sticky top-[52px] z-30 -mx-4 mb-4 overflow-x-auto border-b border-stone-200 bg-stone-50/95 px-4 backdrop-blur">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => `whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition ${isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-stone-500 hover:text-stone-800'}`}
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Outlet context={ctx} />
    </div>
  );
}
