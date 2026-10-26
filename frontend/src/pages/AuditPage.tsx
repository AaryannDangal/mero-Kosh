import { Fragment, useState } from 'react';
import { useGroup } from '../components/GroupLayout';
import { useApi } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { dateTime, num } from '../lib/format';
import { Empty, Section, Spinner } from '../components/ui';

interface Log { id: string; createdAt: string; userName: string | null; action: string; entityType: string; entityId: string | null; oldValue: unknown; newValue: unknown; ipAddress: string | null; reason: string | null }

const short = (v: unknown) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 1));

export function AuditPage() {
  const { group } = useGroup();
  const { t } = useI18n();
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const qs = new URLSearchParams({ pageSize: '300', ...(action ? { action } : {}), ...(entityType ? { entityType } : {}) });
  const { data } = useApi<{ total: number; logs: Log[] }>(`/groups/${group.id}/audit?${qs}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Section title={t('audit')}>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <input className="input" placeholder="Action (e.g. PAYMENT_VERIFIED)" value={action} onChange={(e) => setAction(e.target.value.toUpperCase())} />
        <select className="input" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">Entity / सबै</option>
          {['Group', 'GroupMember', 'Round', 'Bid', 'LedgerEntry', 'Dispute', 'MemberExit'].map((x) => <option key={x}>{x}</option>)}
        </select>
      </div>
      {!data ? <Spinner /> : data.logs.length === 0 ? <Empty /> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Time / समय</th><th>User / प्रयोगकर्ता</th><th>Action / कार्य</th><th>{t('reason')}</th><th>IP</th></tr></thead>
            <tbody>
              {data.logs.map((l) => (
                <Fragment key={l.id}>
                  <tr className="cursor-pointer hover:bg-stone-50" onClick={() => setOpen(open === l.id ? null : l.id)}>
                    <td className="whitespace-nowrap text-xs">{dateTime(l.createdAt)}</td>
                    <td>{l.userName ?? 'system'}</td>
                    <td><span className="font-mono text-xs font-semibold">{l.action}</span><div className="text-[11px] text-stone-500">{l.entityType}</div></td>
                    <td className="max-w-[220px] text-xs">{l.reason}</td>
                    <td className="font-mono text-[11px] text-stone-500">{l.ipAddress}</td>
                  </tr>
                  {open === l.id && (
                    <tr>
                      <td colSpan={5} className="bg-stone-50">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div><div className="label">Old value / पुरानो</div><pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2 text-[11px]">{short(l.oldValue) || '—'}</pre></div>
                          <div><div className="label">New value / नयाँ</div><pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2 text-[11px]">{short(l.newValue) || '—'}</pre></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <p className="mt-2 text-xs text-stone-500">{num(data.total)} entries · append-only</p>}
    </Section>
  );
}
