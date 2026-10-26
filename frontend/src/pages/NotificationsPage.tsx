import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { dateTime } from '../lib/format';
import { Empty, Section, Spinner } from '../components/ui';

interface N { id: string; groupId: string; roundId: string | null; type: string; title: string; body: string; readAt: string | null; createdAt: string; emailSentAt: string | null }

export function NotificationsPage() {
  const { t } = useI18n();
  const { data, reload } = useApi<{ unread: number; notifications: N[] }>('/notifications');
  const changed = () => { reload(); window.dispatchEvent(new Event('dhukuti:notifications')); };
  return (
    <Section title={t('notifications')} action={data?.unread ? <button className="btn-secondary btn-sm" onClick={async () => { await api.post('/notifications/read-all'); changed(); }}>{t('markAllRead')}</button> : null}>
      {!data ? <Spinner /> : data.notifications.length === 0 ? <Empty /> : (
        <ul className="divide-y divide-stone-100">
          {data.notifications.map((n) => (
            <li key={n.id} className={`py-3 ${n.readAt ? 'opacity-70' : ''}`}>
              <Link to={n.roundId ? `/groups/${n.groupId}/rounds/${n.roundId}` : `/groups/${n.groupId}`} onClick={() => !n.readAt && api.post(`/notifications/${n.id}/read`).then(changed)} className="block">
                <div className="flex items-start gap-2">
                  {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{n.title}</div>
                    <div className="whitespace-pre-line text-sm text-stone-600">{n.body}</div>
                    <div className="mt-0.5 text-[11px] text-stone-400">{dateTime(n.createdAt)}{n.emailSentAt && ' · ✉ email sent'}</div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
