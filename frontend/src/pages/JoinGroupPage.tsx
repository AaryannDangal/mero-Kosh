import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, ErrorText, Field } from '../components/ui';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useI18n } from '../lib/i18n';

export function JoinGroupPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { busy, error, run } = useAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setPending(false);
    void run(async () => {
      const result = await api.post<{ status: 'PENDING' | 'APPROVED'; groupId?: string }>('/groups/join', { code, password });
      if (result.status === 'APPROVED' && result.groupId) nav(`/groups/${result.groupId}`);
      else setPending(true);
    });
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('joinExistingGroup')}</h1>
        <p className="mt-1 text-sm text-stone-600">{t('groupCodeHelp')}</p>
      </div>
      <form className="card space-y-4" onSubmit={submit}>
        <Field label={t('groupCode')}>
          <input className="input uppercase" autoCapitalize="characters" autoComplete="off" maxLength={16} minLength={4} required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </Field>
        <Field label={t('groupJoinPassword')}>
          <input className="input" type={showPassword ? 'text' : 'password'} autoComplete="off" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
          {t('showPassword')}
        </label>
        <p className="text-sm text-stone-600">{t('groupJoinApprovalHint')}</p>
        {pending && <Alert tone="green">{t('requestSent')}</Alert>}
        <ErrorText error={error} />
        <button className="btn-primary w-full" disabled={busy}>{t('requestToJoin')}</button>
      </form>
    </div>
  );
}
