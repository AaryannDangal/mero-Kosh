import { useState, type FormEvent } from 'react';
import { useI18n } from '../lib/i18n';
import { fromPaisa, npr, toPaisa, todayIso } from '../lib/format';
import { ErrorText, Field } from './ui';
import type { Group } from '../lib/types';

const WEEKDAYS = { en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], ne: ['आइतबार', 'सोमबार', 'मंगलबार', 'बुधबार', 'बिहीबार', 'शुक्रबार', 'शनिबार'] };

export interface GroupFormValues {
  name: string; description: string; currency: string; contribution: string; memberCount: string; startDate: string;
  frequency: Group['frequency']; collectionDueDay: string; selectionMethod: Group['selectionMethod']; lateFeeType: Group['lateFeeType'];
  lateFee: string; lateFeeCap: string; gracePeriodDays: string; continueAfterPot: boolean; potInterestRatePct: string; minBid: string; bidWinRule: Group['bidWinRule'];
  tieBreakRule: Group['tieBreakRule']; missedPaymentRules: string; earlyExitRules: string; exitPenaltyPct: string; organizerParticipates: boolean; joinPassword: string;
}

export function valuesFromGroup(g?: Group): GroupFormValues {
  return {
    name: g?.name ?? '',
    description: g?.description ?? '',
    currency: g?.currency ?? 'NPR',
    contribution: g ? fromPaisa(g.contributionAmount) : '2000',
    memberCount: String(g?.memberCount ?? 5),
    startDate: g ? g.startDate.slice(0, 10) : todayIso(),
    frequency: g?.frequency ?? 'MONTHLY',
    collectionDueDay: String(g?.collectionDueDay ?? 10),
    selectionMethod: g?.selectionMethod ?? 'FIXED_ROTATION',
    lateFeeType: g?.lateFeeType ?? 'FIXED',
    lateFee: g ? (g.lateFeeType === 'PERCENTAGE' ? String(g.lateFeeValue / 100) : fromPaisa(g.lateFeeValue)) : '500',
    lateFeeCap: g?.lateFeeCap != null ? fromPaisa(g.lateFeeCap) : '',
    gracePeriodDays: String(g?.gracePeriodDays ?? 3),
    continueAfterPot: g?.continueAfterPot ?? true,
    potInterestRatePct: g ? String(g.potInterestRateBp / 100) : '1',
    minBid: g ? fromPaisa(g.minBidDiscount) : '0',
    bidWinRule: g?.bidWinRule ?? 'HIGHEST_DISCOUNT',
    tieBreakRule: g?.tieBreakRule ?? 'EARLIEST',
    missedPaymentRules: g?.missedPaymentRules ?? '',
    earlyExitRules: g?.earlyExitRules ?? '',
    exitPenaltyPct: g ? String(g.earlyExitPenaltyBp / 100) : '0',
    organizerParticipates: true,
    joinPassword: '',
  };
}

/** Convert form values (rupees, %) to the API payload (integer paisa, basis points). */
export function toPayload(v: GroupFormValues, includeOrganizer: boolean) {
  return {
    name: v.name,
    description: v.description.trim() || null,
    currency: v.currency,
    contributionAmount: toPaisa(v.contribution),
    memberCount: Number(v.memberCount),
    startDate: v.startDate,
    frequency: v.frequency,
    collectionDueDay: Number(v.collectionDueDay),
    selectionMethod: v.selectionMethod,
    lateFeeType: v.lateFeeType,
    lateFeeValue: v.lateFeeType === 'NONE' ? 0 : v.lateFeeType === 'PERCENTAGE' ? Math.round(Number(v.lateFee) * 100) : toPaisa(v.lateFee),
    lateFeeCap: v.lateFeeCap === '' ? null : toPaisa(v.lateFeeCap),
    gracePeriodDays: Number(v.gracePeriodDays),
    continueAfterPot: v.continueAfterPot,
    potInterestRateBp: Math.round(Number(v.potInterestRatePct || 1) * 100),
    minBidDiscount: v.selectionMethod === 'BIDDING' ? toPaisa(v.minBid || '0') : 0,
    bidWinRule: v.bidWinRule,
    tieBreakRule: v.tieBreakRule,
    missedPaymentRules: v.missedPaymentRules.trim() || null,
    earlyExitRules: v.earlyExitRules.trim() || null,
    earlyExitPenaltyBp: Math.round(Number(v.exitPenaltyPct || 0) * 100),
    ...(includeOrganizer ? { joinPassword: v.joinPassword } : {}),
    ...(includeOrganizer ? { organizerParticipates: v.organizerParticipates } : {}),
  };
}

export function GroupForm({ initial, onSubmit, submitLabel, busy, error, isCreate, locked }: {
  initial: GroupFormValues; onSubmit: (v: GroupFormValues) => void; submitLabel: string; busy: boolean; error: string | null; isCreate?: boolean; locked?: boolean;
}) {
  const { t, lang } = useI18n();
  const [v, setV] = useState(initial);
  const [showJoinPassword, setShowJoinPassword] = useState(false);
  const set = <K extends keyof GroupFormValues>(k: K, val: GroupFormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const inp = (k: keyof GroupFormValues) => ({ value: v[k] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(k, e.target.value as never), disabled: locked });
  const pot = toPaisa(v.contribution || '0') * Number(v.memberCount || 0);
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(v); };
  const onFreq = (f: Group['frequency']) => setV((p) => ({ ...p, frequency: f, collectionDueDay: f === 'MONTHLY' ? '10' : '0' }));

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset className="card grid gap-3 sm:grid-cols-2" disabled={busy}>
        <Field label={t('groupName')} className="sm:col-span-2"><input className="input" required minLength={2} {...inp('name')} disabled={false} /></Field>
        <Field label={t('description')} className="sm:col-span-2"><textarea className="input" rows={2} {...inp('description')} disabled={false} /></Field>
        <Field label={t('currency')}><input className="input uppercase" maxLength={3} required {...inp('currency')} /></Field>
        <Field label={t('contributionAmount')} className="sm:col-span-2">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {['1000', '2000', '3000', '4000', '5000'].map((amt) => (
                <button
                  type="button"
                  key={amt}
                  disabled={locked}
                  onClick={() => set('contribution', amt)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    v.contribution === amt ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                  }`}
                >
                  {npr(toPaisa(amt), v.currency)} / mo
                </button>
              ))}
            </div>
            <input className="input" type="number" min="1" step="1" inputMode="numeric" required {...inp('contribution')} placeholder="Custom amount" />
          </div>
        </Field>
        <Field label={t('memberCount')}><input className="input" type="number" min="2" max="100" required {...inp('memberCount')} /></Field>
        <Field label={t('startDate')}><input className="input" type="date" required {...inp('startDate')} /></Field>
        <Field label={t('frequency')}>
          <select className="input" value={v.frequency} onChange={(e) => onFreq(e.target.value as Group['frequency'])} disabled={locked}>
            {(['MONTHLY', 'BIWEEKLY', 'WEEKLY'] as const).map((f) => <option key={f} value={f}>{t(f)}</option>)}
          </select>
        </Field>
        <Field label={t('dueDay')}>
          <select className="input" {...inp('collectionDueDay')}>
            {v.frequency === 'MONTHLY'
              ? Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)
              : WEEKDAYS[lang].map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </Field>
        <div className="rounded-xl bg-brand-50 p-3 text-sm sm:col-span-2">
          {t('fullPot')}: <b>{npr(pot, v.currency)}</b> <span className="text-stone-500">= {npr(toPaisa(v.contribution || '0'), v.currency)} × {v.memberCount}</span>
        </div>
      </fieldset>

      {isCreate && <fieldset className="card grid gap-3 sm:grid-cols-2" disabled={busy}>
        <Field label={t('groupJoinPassword')} hint={t('groupJoinPasswordHint')} className="sm:col-span-2">
          <input className="input" type={showJoinPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} required {...inp('joinPassword')} disabled={false} />
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm text-stone-700 sm:col-span-2">
          <input type="checkbox" checked={showJoinPassword} onChange={(e) => setShowJoinPassword(e.target.checked)} />
          {t('showPassword')}
        </label>
        <p className="text-xs text-stone-600 sm:col-span-2">{t('groupJoinApprovalHint')}</p>
      </fieldset>}

      <fieldset className="card grid gap-3 sm:grid-cols-2" disabled={busy}>
        <Field label={t('selectionMethod')} className="sm:col-span-2">
          <div className="grid gap-2 sm:grid-cols-3">
            {(['FIXED_ROTATION', 'ADMIN_SELECTION', 'BIDDING'] as const).map((m) => (
              <button type="button" key={m} disabled={locked} onClick={() => set('selectionMethod', m)}
                className={`rounded-xl border-2 p-3 text-left text-sm font-semibold ${v.selectionMethod === m ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-stone-200'}`}>
                {t(m)}
              </button>
            ))}
          </div>
        </Field>
        {v.selectionMethod === 'ADMIN_SELECTION' && (
          <div className="rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm text-brand-800 sm:col-span-2">{t('adminSelectionHint')}</div>
        )}
        {v.selectionMethod === 'BIDDING' && (
          <>
            <Field label={t('minBid')}><input className="input" type="number" min="0" step="0.01" {...inp('minBid')} /></Field>
            <Field label={t('bidWinRule')}>
              <select className="input" {...inp('bidWinRule')}>{(['HIGHEST_DISCOUNT', 'LOWEST_DISCOUNT'] as const).map((r) => <option key={r} value={r}>{t(r)}</option>)}</select>
            </Field>
            <Field label={t('tieBreak')}>
              <select className="input" {...inp('tieBreakRule')}>{(['EARLIEST', 'RANDOM'] as const).map((r) => <option key={r} value={r}>{t(r)}</option>)}</select>
            </Field>
          </>
        )}
        <Field label={t('potInterestRate')} hint={t('potInterestRateHint')} className="sm:col-span-2">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {['0', '1', '2', '3', '5'].map((pct) => (
                <button
                  type="button"
                  key={pct}
                  disabled={locked}
                  onClick={() => set('potInterestRatePct', pct)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    v.potInterestRatePct === pct ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                  }`}
                >
                  {pct}% / month
                </button>
              ))}
            </div>
            <input className="input" type="number" min="0" max="100" step="0.1" inputMode="decimal" required {...inp('potInterestRatePct')} />
          </div>
        </Field>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={v.continueAfterPot} disabled={locked} onChange={(e) => set('continueAfterPot', e.target.checked)} />
          {t('continueAfterPot')}
        </label>
        {isCreate && (
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-1" checked={v.organizerParticipates} onChange={(e) => set('organizerParticipates', e.target.checked)} />
            {t('organizerParticipates')}
          </label>
        )}
      </fieldset>

      <fieldset className="card grid gap-3 sm:grid-cols-2" disabled={busy}>
        <Field label={t('lateFeeType')}>
          <select className="input" {...inp('lateFeeType')}>{(['NONE', 'FIXED', 'PERCENTAGE', 'DAILY'] as const).map((r) => <option key={r} value={r}>{t(r)}</option>)}</select>
        </Field>
        {v.lateFeeType !== 'NONE' && (
          <Field label={`${t('lateFeeValue')} ${v.lateFeeType === 'PERCENTAGE' ? '(%)' : v.lateFeeType === 'DAILY' ? `(${v.currency}/day)` : `(${v.currency})`}`}>
            <input className="input" type="number" min="0" step="0.01" required {...inp('lateFee')} />
          </Field>
        )}
        {v.lateFeeType !== 'NONE' && <Field label={t('lateFeeCap')}><input className="input" type="number" min="0" step="0.01" {...inp('lateFeeCap')} /></Field>}
        <Field label={t('gracePeriod')}><input className="input" type="number" min="0" max="60" {...inp('gracePeriodDays')} /></Field>
        <Field label={t('missedRules')} className="sm:col-span-2"><textarea className="input" rows={2} {...inp('missedPaymentRules')} /></Field>
        <Field label={t('exitRules')} className="sm:col-span-2"><textarea className="input" rows={2} {...inp('earlyExitRules')} /></Field>
        <Field label={t('exitPenalty')}><input className="input" type="number" min="0" max="100" step="0.01" {...inp('exitPenaltyPct')} /></Field>
      </fieldset>

      <ErrorText error={error} />
      <button className="btn-primary w-full sm:w-auto" disabled={busy}>{submitLabel}</button>
    </form>
  );
}
