import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { useGroup } from '../components/GroupLayout';
import { GroupForm, toPayload, valuesFromGroup } from '../components/GroupForm';
import { Alert, ErrorText, Field, Modal, Section } from '../components/ui';

export function SettingsPage() {
  const { t } = useI18n();
  const { group, myRole, reloadGroup } = useGroup();
  const nav = useNavigate();
  const save = useAction();
  const del = useAction();
  const [saved, setSaved] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const locked = group.status !== 'DRAFT';
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Alert tone="blue">{t('editSettingsDraftOnly')}</Alert>
      {saved && <Alert tone="green">✓ {t('save')}</Alert>}
      <GroupForm
        key={group.id + group.status}
        initial={valuesFromGroup(group)}
        locked={locked}
        submitLabel={t('save')}
        busy={save.busy}
        error={save.error}
        onSubmit={(v) => save.run(async () => {
          const payload = toPayload(v, false);
          // after the start only cosmetic fields may change
          await api.patch(`/groups/${group.id}`, locked ? { name: payload.name, description: payload.description } : payload);
          await reloadGroup();
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        })}
      />
      {myRole === 'ORGANIZER' && (
        <Section title={t('deleteGroup')}>
          <p className="mb-3 text-sm text-stone-600">The group is hidden for all members. Ledger and audit history are kept (soft delete). / समूह सबैबाट लुकाइन्छ, हिसाब र अडिट इतिहास सुरक्षित रहन्छ।</p>
          <button className="btn-danger" onClick={() => setDelOpen(true)}>{t('deleteGroup')}</button>
        </Section>
      )}
      <Modal open={delOpen} onClose={() => setDelOpen(false)} title={t('deleteGroup')}>
        <div className="space-y-3">
          <Field label={t('reason')}><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <ErrorText error={del.error} />
          <button className="btn-danger w-full" disabled={del.busy || reason.trim().length < 3}
            onClick={() => del.run(async () => { await api.del(`/groups/${group.id}`, { reason }); nav('/'); })}>
            {t('deleteGroup')}
          </button>
        </div>
      </Modal>
    </div>
  );
}
