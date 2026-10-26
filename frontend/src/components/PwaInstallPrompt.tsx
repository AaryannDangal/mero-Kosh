import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISSED_KEY = 'merokosh.install-prompt-dismissed';

function isIosDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function PwaInstallPrompt({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const { t } = useI18n();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    try { setDismissed(sessionStorage.getItem(DISMISSED_KEY) === '1'); } catch { /* storage may be unavailable */ }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    const onDisplayModeChange = (event: MediaQueryListEvent) => setInstalled(event.matches);
    const displayMode = window.matchMedia('(display-mode: standalone)');

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    displayMode.addEventListener?.('change', onDisplayModeChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      displayMode.removeEventListener?.('change', onDisplayModeChange);
    };
  }, []);

  if (installed || dismissed || (!isIosDevice() && !/Android/i.test(navigator.userAgent))) return null;

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === 'accepted') setInstalled(true);
  };

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISSED_KEY, '1'); } catch { /* dismissal lasts for this view */ }
  };

  const panelTone = tone === 'dark'
    ? 'border-white/20 bg-white/10 text-white'
    : 'border-brand-100 bg-brand-50 text-brand-800';
  const hintTone = tone === 'dark' ? 'text-white/85' : 'text-brand-700';
  const closeTone = tone === 'dark'
    ? 'text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-white'
    : 'text-brand-600 hover:bg-brand-100 hover:text-brand-800 focus-visible:outline-brand-600';

  return (
    <aside className={`mb-4 flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-sm ${panelTone}`} aria-label={t('installApp')}>
      <svg className="mt-0.5 shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t('installApp')}</p>
        <p className={`mt-0.5 text-xs leading-relaxed ${hintTone}`}>
          {isIosDevice() ? t('installAppIosHint') : t('installAppAndroidHint')}
        </p>
        {installPrompt && (
          <button type="button" className="mt-2 min-h-11 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" onClick={install}>
            {t('installAppAction')}
          </button>
        )}
      </div>
      <button type="button" className={`-mr-1 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${closeTone}`} onClick={dismiss} aria-label={t('dismissInstallPrompt')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" strokeLinecap="round" /></svg>
      </button>
    </aside>
  );
}
