import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { GroupForm, toPayload, valuesFromGroup } from '../components/GroupForm';

export function CreateGroupPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { busy, error, run } = useAction();
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h1 className="text-2xl font-bold">{t('createGroup')}</h1>
      <GroupForm
        isCreate
        initial={valuesFromGroup()}
        submitLabel={t('createGroup')}
        busy={busy}
        error={error}
        onSubmit={(v) => run(async () => {
          const r = await api.post<{ group: { id: string } }>('/groups', toPayload(v, true));
          nav(`/groups/${r.group.id}/members`);
        })}
      />
    </div>
  );
}
