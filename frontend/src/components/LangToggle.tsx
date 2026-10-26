import { useI18n } from '../lib/i18n';

export function LangToggle({ className = '' }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={`inline-flex rounded-lg border border-white/30 p-0.5 text-xs font-semibold ${className}`} role="group" aria-label="Language">
      {(['en', 'ne'] as const).map((l) => (
        <button key={l} onClick={() => setLang(l)} className={`rounded-md px-2 py-1 transition ${lang === l ? 'bg-white text-brand-700' : 'opacity-80 hover:opacity-100'}`}>
          {l === 'en' ? 'EN' : 'नेपाली'}
        </button>
      ))}
    </div>
  );
}
