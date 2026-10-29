import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGroup } from '../components/GroupLayout';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { dateTime } from '../lib/format';
import { Alert, ErrorText, Section } from '../components/ui';

export function RulesPage() {
  const { group, rules, isManager, reloadGroup } = useGroup();
  const { t } = useI18n();
  const nav = useNavigate();
  const { busy, error, run } = useAction();
  const [agree, setAgree] = useState(false);
  const draft = group.status === 'DRAFT';
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Group rules (English)">
          <ol className="ml-5 list-decimal space-y-1.5 text-sm">{rules.en.map((r, i) => <li key={i}>{r}</li>)}</ol>
        </Section>
        <Section title="समूहका नियमहरू (नेपाली)">
          <ol className="ml-5 list-decimal space-y-1.5 text-sm" lang="ne">{rules.ne.map((r, i) => <li key={i}>{r}</li>)}</ol>
        </Section>
      </div>
      {group.rulesConfirmedAt ? (
        <Alert tone="green">✓ {t('rulesConfirmed')} · {dateTime(group.rulesConfirmedAt)}</Alert>
      ) : (
        <Alert>The organizer must confirm these rules before round 1 can start. / पहिलो चरण सुरु गर्नुअघि आयोजकले नियम पुष्टि गर्नुपर्छ।</Alert>
      )}
      {isManager && draft && (
        <div className="card space-y-3">
          {!group.rulesConfirmedAt && (
            <>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I have read the rules in English and Nepali and shared them with all members. / मैले नियमहरू पढेँ र सबै सदस्यलाई जानकारी गराएँ।</label>
              <button className="btn-primary" disabled={!agree || busy} onClick={() => run(async () => { await api.post(`/groups/${group.id}/confirm-rules`); await reloadGroup(); })}>{t('confirmRules')}</button>
            </>
          )}
          {group.rulesConfirmedAt && (
            <button className="btn-primary" disabled={busy} onClick={() => run(async () => { await api.post(`/groups/${group.id}/start`); await reloadGroup(); nav(`/groups/${group.id}`); })}>▶ {t('startGroup')}</button>
          )}
          <ErrorText error={error} />
        </div>
      )}
    </div>
  );
}
