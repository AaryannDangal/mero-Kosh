import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';

// green = paid/completed, yellow = pending/partial, red = overdue/defaulted
const GREEN = ['PAID', 'COMPLETED', 'VERIFIED', 'BALANCED', 'RECEIVED_POT', 'ACTIVE', 'RESOLVED', 'CLOSED'];
const YELLOW = ['PENDING', 'PARTIAL', 'COLLECTING', 'PAYOUT_PENDING', 'WAITING', 'WAITING_FOR_TURN', 'OPEN', 'SETTLEMENT', 'NOT_STARTED', 'UNPAID'];
const RED = ['OVERDUE', 'DEFAULTED', 'REJECTED', 'DISPUTED', 'MISMATCH', 'SUSPENDED'];

export function statusTone(s: string): 'green' | 'yellow' | 'red' | 'gray' {
  if (GREEN.includes(s)) return 'green';
  if (RED.includes(s)) return 'red';
  if (YELLOW.includes(s)) return 'yellow';
  return 'gray';
}
const TONES = {
  green: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20',
  yellow: 'bg-amber-100 text-amber-800 ring-amber-600/20',
  red: 'bg-red-100 text-red-800 ring-red-600/20',
  gray: 'bg-stone-100 text-stone-700 ring-stone-500/20',
  blue: 'bg-sky-100 text-sky-800 ring-sky-600/20',
};

export function Badge({ status, label, tone }: { status?: string; label?: string; tone?: keyof typeof TONES }) {
  const { t } = useI18n();
  const tn = tone ?? (status ? statusTone(status) : 'gray');
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[tn]}`}>{label ?? (status ? t(status) : '')}</span>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'green' | 'yellow' | 'red' }) {
  const color = tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-red-700' : tone === 'yellow' ? 'text-amber-700' : 'text-stone-900';
  return (
    <div className="card !p-3">
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className={`mt-1 text-lg font-bold leading-tight sm:text-xl ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

export function Alert({ tone = 'yellow', children, title }: { tone?: 'yellow' | 'red' | 'green' | 'blue'; children: ReactNode; title?: string }) {
  const c = {
    yellow: 'border-amber-300 bg-amber-50 text-amber-900',
    red: 'border-red-300 bg-red-50 text-red-900',
    green: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    blue: 'border-sky-300 bg-sky-50 text-sky-900',
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2 text-sm ${c}`} role={tone === 'red' ? 'alert' : undefined}>
      {title && <div className="font-semibold">{title}</div>}
      <div>{children}</div>
    </div>
  );
}

export function ErrorText({ error }: { error?: string | null }) {
  if (!error) return null;
  return <Alert tone="red">{error}</Alert>;
}

export function Spinner() {
  const { t } = useI18n();
  return <div className="flex items-center justify-center p-8 text-sm text-stone-500"><span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />{t('loading')}</div>;
}

export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return <div className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">{children ?? t('noData')}</div>;
}

export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="rounded-lg p-1 text-stone-500 hover:bg-stone-100" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Authenticated image (profile photos are behind auth, so <img src> cannot be used directly). */
export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return;
    let u: string | null = null;
    api.blob(src).then((b) => { u = URL.createObjectURL(b); setUrl(u); }).catch(() => setUrl(null));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [src]);
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return url ? (
    <img src={url} alt={name} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials}</span>
  );
}

export function ProgressBar({ value, max, tone = 'green' }: { value: number; max: number; tone?: 'green' | 'yellow' | 'red' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const c = tone === 'green' ? 'bg-emerald-500' : tone === 'red' ? 'bg-red-500' : 'bg-amber-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200">
      <div className={`h-full ${c} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}
