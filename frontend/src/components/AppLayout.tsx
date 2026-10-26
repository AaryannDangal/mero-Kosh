import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';
import { LangToggle } from './LangToggle';
import { BrandLogo } from './BrandLogo';
import { PwaInstallPrompt } from './PwaInstallPrompt';

export function AppLayout() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const load = () => api.get<{ unread: number }>('/notifications').then((r) => setUnread(r.unread)).catch(() => {});
    load();
    const id = setInterval(load, 60000);
    window.addEventListener('dhukuti:notifications', load);
    return () => { clearInterval(id); window.removeEventListener('dhukuti:notifications', load); };
  }, []);
  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-40 bg-brand-600 text-white shadow">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2 font-bold">
            <BrandLogo size={34} />
            <span className="hidden sm:inline">{t('appName')}</span>
          </Link>
          <div className="flex-1" />
          <LangToggle />
          <Link to="/notifications" className="relative rounded-lg p-2 hover:bg-white/10" aria-label={t('notifications')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
            {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-gold-400 px-1 text-center text-[11px] font-bold text-stone-900">{unread > 99 ? '99+' : unread}</span>}
          </Link>
          <Link to="/account" className="rounded-lg px-2 py-1.5 text-xs font-semibold hover:bg-white/10">{t('accountSettings')}</Link>
          <button
            className="rounded-lg px-2 py-1.5 text-xs font-semibold hover:bg-white/10"
            onClick={() => { logout(); nav('/login'); }}
            title={user?.email ?? undefined}
          >
            {t('logout')}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-4">
        <div className="mx-auto max-w-2xl"><PwaInstallPrompt tone="light" /></div>
        <Outlet />
      </main>
      <footer className="mx-auto mt-10 max-w-6xl px-4 text-center text-[11px] text-stone-400">
        <p>{t('noMoneyNotice')}</p>
        <Link className="mt-2 inline-block min-h-11 px-3 py-3 underline underline-offset-2" to="/privacy">{t('privacyPolicy')}</Link>
      </footer>
    </div>
  );
}
