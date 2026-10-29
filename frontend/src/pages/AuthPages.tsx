import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { Alert, ErrorText, Field } from '../components/ui';
import { LangToggle } from '../components/LangToggle';
import { BrandLogo } from '../components/BrandLogo';
import { PwaInstallPrompt } from '../components/PwaInstallPrompt';
import type { User } from '../lib/types';

declare global {
  interface Window { google?: any }
}

function Shell({ children, title }: { children: ReactNode; title: string }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-brand-600 to-brand-700 px-4 py-6">
      <div className="mx-auto flex w-full max-w-md justify-end text-white"><LangToggle /></div>
      <div className="mx-auto mt-6 w-full max-w-md">
        <PwaInstallPrompt />
        <div className="mb-6 text-center text-white">
          <BrandLogo size={64} className="rounded-2xl shadow-lg" />
          <h1 className="mt-2 text-2xl font-bold">{t('appName')}</h1>
          <p className="text-sm text-white/80">{t('tagline')}</p>
        </div>
        <div className="auth-depth">
          <div className="card auth-card !p-5">
          <h2 className="mb-4 text-lg font-bold">{title}</h2>
          {children}
          </div>
        </div>
        <p className="mt-4 text-center text-[11px] text-white/70">{t('noMoneyNotice')}</p>
        <p className="mt-3 text-center text-xs"><Link className="text-white underline underline-offset-2" to="/privacy">{t('privacyPolicy')}</Link></p>
      </div>
    </div>
  );
}

export function GoogleButton({ onToken, label }: { onToken: (credential: string) => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const { t } = useI18n();
  useEffect(() => { api.get<{ googleClientId: string | null }>('/auth/config').then((c) => setClientId(c.googleClientId)).catch(() => {}); }, []);
  useEffect(() => {
    if (!clientId) return;
    const init = () => {
      window.google?.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => onToken(r.credential) });
      if (ref.current) window.google?.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: 320 });
    };
    if (window.google) return init();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = init;
    document.head.appendChild(s);
  }, [clientId, onToken]);
  if (!clientId) return null;
  return (
    <div className="mt-4">
      {label ? <p className="mb-3 text-sm text-stone-700">{label}</p> : <div className="mb-3 flex items-center gap-2 text-xs text-stone-400"><div className="h-px flex-1 bg-stone-200" />{t('orContinue')}<div className="h-px flex-1 bg-stone-200" /></div>}
      <div ref={ref} className="flex justify-center" />
    </div>
  );
}

function useFinish() {
  const { setSession } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  return (r: { token: string; user: User }) => {
    setSession(r.token, r.user);
    nav((loc.state as { from?: string } | null)?.from ?? '/', { replace: true });
  };
}

export function LoginPage() {
  const { t } = useI18n();
  const location = useLocation();
  const accountDeleted = (location.state as { accountDeleted?: boolean } | null)?.accountDeleted;
  const { user } = useAuth();
  const finish = useFinish();
  const { busy, error, run } = useAction();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  if (user) return <Navigate to="/" replace />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => finish(await api.post('/auth/login', { identifier, password })));
  };
  return (
    <Shell title={t('login')}>
      {accountDeleted && <Alert tone="green">{t('accountDeleted')}</Alert>}
      <form onSubmit={submit} className="space-y-3">
        <Field label={t('emailOrPhone')}><input className="input" type="text" autoComplete="username" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} /></Field>
        <Field label={t('password')}><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorText error={error} />
        <button className="btn-primary w-full" disabled={busy}>{t('login')}</button>
      </form>
      <p className="mt-3 text-right text-sm"><Link className="font-semibold text-brand-600" to="/forgot-password">{t('forgotPassword')}</Link></p>
      <GoogleButton onToken={(credential) => run(async () => finish(await api.post('/auth/google', { credential })))} />
      <p className="mt-4 text-center text-sm">{t('noAccount')} <Link to="/register" className="font-semibold text-brand-600">{t('register')}</Link></p>
    </Shell>
  );
}

export function RegisterPage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const finish = useFinish();
  const { busy, error, run } = useAction();
  const [f, setF] = useState({ fullName: '', email: '', phone: '', password: '' });
  if (user) return <Navigate to="/" replace />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => finish(await api.post('/auth/register', { ...f, preferredLanguage: lang })));
  };
  return (
    <Shell title={t('register')}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t('fullName')}><input className="input" required minLength={2} value={f.fullName} onChange={set('fullName')} /></Field>
        <Field label={t('emailOptional')} hint={t('emailOptionalHint')}><input className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} /></Field>
        <Field label={t('phone')} hint={`${t('phoneRequired')} · ${t('phoneHint')}`}><input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+977 98… or +1 202…" required value={f.phone} onChange={set('phone')} /></Field>
        <Field label={t('password')} hint="min. 8"><input className="input" type="password" autoComplete="new-password" required minLength={8} value={f.password} onChange={set('password')} /></Field>
        <ErrorText error={error} />
        <button className="btn-primary w-full" disabled={busy}>{t('register')}</button>
      </form>
      <GoogleButton onToken={(credential) => run(async () => finish(await api.post('/auth/google', { credential, phone: f.phone })))} />
      <p className="mt-4 text-center text-sm">{t('haveAccount')} <Link to="/login" className="font-semibold text-brand-600">{t('login')}</Link></p>
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <Shell title={t('forgotPassword')}>
      {sent ? <p role="status" className="text-sm text-stone-700">{t('resetRequested')}</p> : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post('/auth/password-reset/request', { email }); setSent(true); }); }}>
          <Field label={t('email')} hint={t('resetRequested')}><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <ErrorText error={error} />
          <button className="btn-primary w-full" disabled={busy}>{t('requestReset')}</button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link className="font-semibold text-brand-600" to="/login">{t('login')}</Link></p>
    </Shell>
  );
}

export function VerifyEmailPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <Shell title={t('emailVerification')}>
      {done ? <p role="status" className="text-sm text-stone-700">{t('emailVerifiedSuccess')}</p> : (
        <div className="space-y-3">
          {!token && <p className="text-sm text-red-700">{t('linkInvalid')}</p>}
          {token && <button className="btn-primary w-full" disabled={busy} onClick={() => run(async () => { await api.post('/auth/verify-email/confirm', { token }); setDone(true); })}>{t('emailVerification')}</button>}
          <ErrorText error={error} />
        </div>
      )}
      <p className="mt-4 text-center text-sm"><Link className="font-semibold text-brand-600" to="/login">{t('login')}</Link></p>
    </Shell>
  );
}

export function ResetPasswordPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <Shell title={t('resetPassword')}>
      {done ? <p role="status" className="text-sm text-stone-700">{t('passwordUpdated')} <Link className="font-semibold text-brand-600" to="/login">{t('login')}</Link></p> : !token ? (
        <p className="text-sm text-red-700">{t('linkInvalid')}</p>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post('/auth/password-reset/confirm', { token, password }); setDone(true); }); }}>
          <Field label={t('newPassword')} hint="8 characters minimum"><input className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <ErrorText error={error} />
          <button className="btn-primary w-full" disabled={busy}>{t('resetPassword')}</button>
        </form>
      )}
    </Shell>
  );
}
