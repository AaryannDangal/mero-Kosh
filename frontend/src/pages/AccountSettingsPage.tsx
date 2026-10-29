import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, ErrorText, Field, Section } from '../components/ui';
import { api, tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, useApi } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { GoogleButton } from './AuthPages';

export function AccountSettingsPage() {
  const { user, setSession, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(user?.emailNotificationsEnabled ?? false);
  const [notice, setNotice] = useState('');
  const { data: config } = useApi<{ emailConfigured: boolean }>('/auth/config');
  const save = useAction();
  const verify = useAction();
  const deletion = useAction();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteIdentifier, setDeleteIdentifier] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [googleCredential, setGoogleCredential] = useState('');

  useEffect(() => {
    setEmail(user?.email ?? '');
    setPhone(user?.phone ?? '');
    setEmailNotificationsEnabled(user?.emailNotificationsEnabled ?? false);
  }, [user?.email, user?.phone, user?.emailNotificationsEnabled]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      const token = tokenStore.get();
      const result = await api.patch<{ user: NonNullable<typeof user> }>('/auth/me', {
        email: email.trim() || null,
        phone: phone.trim(),
        emailNotificationsEnabled: email !== user?.email ? false : emailNotificationsEnabled,
      });
      if (token) setSession(token, result.user);
      setNotice(t('preferencesSaved'));
    });
  };

  const requestVerification = () => verify.run(async () => {
    await api.post('/auth/verify-email/request');
    setNotice(t('verificationRequested'));
  });

  const deleteAccount = (e: FormEvent) => {
    e.preventDefault();
    deletion.run(async () => {
      await api.post('/auth/delete-account', {
        identifier: deleteIdentifier.trim(),
        ...(user?.hasPassword ? { password: deletePassword } : {}),
        ...(user?.hasGoogle && !user.hasPassword ? { googleCredential } : {}),
        confirmation: deleteConfirmation,
      });
      logout();
      navigate('/login', { replace: true, state: { accountDeleted: true } });
    });
  };

  const emailChanged = email.trim() !== (user?.email ?? '');
  const canEnableEmail = !!user?.email && user.emailVerified && !emailChanged;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">{t('accountSettings')}</h1>
      {notice && <Alert tone="green">{notice}</Alert>}
      <Section title={t('accountSettings')}>
        <form className="space-y-4" onSubmit={submit}>
          <Field label={t('emailOptional')} hint={t('emailRecoveryHint')}>
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setNotice(''); }} />
          </Field>
          <Field label={t('phone')} hint={t('phoneHint')}>
            <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+977 98… or +1 202…" value={phone} onChange={(e) => { setPhone(e.target.value); setNotice(''); }} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{t('emailVerification')}: <strong>{user?.emailVerified && !emailChanged ? t('emailVerified') : t('emailNotVerified')}</strong></span>
            {email && !user?.emailVerified && !emailChanged && (
              <button className="btn-secondary btn-sm" type="button" disabled={verify.busy || !config?.emailConfigured} onClick={requestVerification}>{t('sendVerification')}</button>
            )}
          </div>
          {!config?.emailConfigured && email && <p className="text-sm text-amber-800">{t('mailNotConfigured')}</p>}
          <label className="flex items-start gap-3 rounded-xl border border-stone-200 p-3 text-sm">
            <input className="mt-1 size-4 accent-emerald-700" type="checkbox" checked={emailNotificationsEnabled} disabled={!canEnableEmail}
              onChange={(e) => { setEmailNotificationsEnabled(e.target.checked); setNotice(''); }} />
            <span><strong>{t('emailNotifications')}</strong><span className="mt-1 block text-stone-600">{t('emailNotificationsHint')}</span></span>
          </label>
          <ErrorText error={verify.error || save.error} />
          <button className="btn-primary" disabled={save.busy}>{t('savePreferences')}</button>
        </form>
      </Section>
      <section className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-sm">
        <div className="border-b border-red-100 bg-red-50/70 px-5 py-4">
          <h2 className="font-bold text-red-950">{t('deleteAccount')}</h2>
          <p className="mt-1 text-sm leading-6 text-red-900">{t('deleteAccountDescription')}</p>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-sm leading-6 text-stone-700">{t('deleteAccountDataNotice')}</p>
          <p className="text-sm text-stone-600">{t('deleteAccountOrganizerNotice')}</p>
          {!deleteOpen ? (
            <button className="btn-danger min-h-11" type="button" onClick={() => { setDeleteOpen(true); deletion.setError(null); }}>{t('deleteAccountStart')}</button>
          ) : (
            <form className="space-y-4 border-t border-red-100 pt-4" onSubmit={deleteAccount}>
              {user?.hasPassword && <Field label={t('deleteAccountPassword')}>
                <input className="input" type="password" autoComplete="current-password" required value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
              </Field>}
              {user?.hasGoogle && !user.hasPassword && <GoogleButton label={t('deleteAccountGoogle')} onToken={setGoogleCredential} />}
              <Field label={t('deleteAccountIdentifier')} hint={t('deleteAccountIdentifierHint')}>
                <input className="input" type="text" autoComplete="off" required value={deleteIdentifier} onChange={(e) => setDeleteIdentifier(e.target.value)} />
              </Field>
              <Field label={t('deleteAccountTypeDelete')}>
                <input className="input" type="text" autoComplete="off" required value={deleteConfirmation} onChange={(e) => setDeleteConfirmation(e.target.value)} />
              </Field>
              <ErrorText error={deletion.error} />
              <div className="flex flex-wrap gap-3">
                <button className="btn-danger min-h-11" disabled={deletion.busy || deleteConfirmation !== 'DELETE' || (!!user?.hasGoogle && !user.hasPassword && !googleCredential)}>{deletion.busy ? t('deletingAccount') : t('deleteAccountFinal')}</button>
                <button className="btn-secondary min-h-11" type="button" disabled={deletion.busy} onClick={() => setDeleteOpen(false)}>{t('cancel')}</button>
              </div>
              <p className="text-xs leading-5 text-stone-500">{t('privacyQuestions')} <a className="font-semibold text-brand-700 underline" href="mailto:itidady@gmail.com">itidady@gmail.com</a></p>
            </form>
          )}
        </div>
      </section>
      <p className="text-center text-xs text-stone-500"><Link className="underline underline-offset-2" to="/privacy">{t('privacyPolicy')}</Link></p>
    </div>
  );
}
