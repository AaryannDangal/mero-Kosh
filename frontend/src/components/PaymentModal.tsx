import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { fromPaisa, npr, toPaisa, todayIso } from '../lib/format';
import { ErrorText, Field, Modal } from './ui';
import { METHODS, type EntryType, type PaymentMethod } from '../lib/types';

const MEMBER_TYPES: EntryType[] = ['CONTRIBUTION', 'LATE_FEE', 'PENALTY'];
const MANAGER_TYPES: EntryType[] = ['CONTRIBUTION', 'LATE_FEE', 'PENALTY', 'REFUND', 'MANUAL_ADJUSTMENT'];

export interface PaymentDefaults {
  memberId?: string;
  roundId?: string | null;
  type?: EntryType;
  amount?: number; // paisa
}

export function PaymentModal({
  open, onClose, onDone, groupId, isManager, myMemberId, defaults, members, rounds, currency,
}: {
  open: boolean; onClose: () => void; onDone: () => void; groupId: string; isManager: boolean; myMemberId: string;
  defaults?: PaymentDefaults; members: { id: string; fullName: string; isContributor: boolean; status: string }[];
  rounds: { id: string; roundNumber: number; status: string }[]; currency: string;
}) {
  const { t } = useI18n();
  const { busy, error, run, setError } = useAction();
  const blank = () => ({
    memberId: defaults?.memberId ?? (isManager ? '' : myMemberId),
    roundId: defaults?.roundId ?? rounds.find((r) => ['COLLECTING', 'PAYOUT_PENDING', 'DISPUTED'].includes(r.status))?.id ?? '',
    type: defaults?.type ?? ('CONTRIBUTION' as EntryType),
    amount: defaults?.amount ? fromPaisa(defaults.amount) : '',
    method: 'ESEWA' as PaymentMethod,
    referenceNumber: '',
    proofUrl: '',
    paidAt: todayIso(),
    notes: '',
    verify: false,
    cashReceivedInPerson: false,
  });
  const [f, setF] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => { if (open) { setF(blank()); setFile(null); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof ReturnType<typeof blank>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const types = isManager ? MANAGER_TYPES : MEMBER_TYPES;
  const hasProof = !!file || !!f.proofUrl;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api.form(`/groups/${groupId}/transactions`, {
        memberId: f.memberId, roundId: f.roundId, type: f.type, amount: toPaisa(f.amount), method: f.method,
        referenceNumber: f.referenceNumber, proofUrl: f.proofUrl, paidAt: f.paidAt, notes: f.notes,
        verify: f.verify && hasProof, cashReceivedInPerson: f.cashReceivedInPerson,
      }, file);
      window.dispatchEvent(new Event('dhukuti:notifications'));
      onDone();
      onClose();
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={isManager ? t('recordPayment') : t('uploadProof')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {isManager && (
            <Field label={t('member')} className="col-span-2">
              <select className="input" required value={f.memberId} onChange={set('memberId')}>
                <option value="">—</option>
                {members.filter((m) => m.isContributor).map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
              </select>
            </Field>
          )}
          <Field label={t('type')}>
            <select className="input" value={f.type} onChange={set('type')}>{types.map((x) => <option key={x} value={x}>{t(x)}</option>)}</select>
          </Field>
          <Field label={t('round')}>
            <select className="input" value={f.roundId ?? ''} onChange={set('roundId')} required={f.type === 'CONTRIBUTION' || f.type === 'LATE_FEE'}>
              <option value="">—</option>
              {rounds.filter((r) => r.status !== 'UPCOMING').map((r) => <option key={r.id} value={r.id}>{t('round')} {r.roundNumber}</option>)}
            </select>
          </Field>
          <Field label={`${t('amount')} (${currency})`} hint={defaults?.amount ? `${t('amountDue')}: ${npr(defaults.amount, currency)}` : f.type === 'MANUAL_ADJUSTMENT' ? '+ / −' : undefined}>
            <input className="input" type="number" step="0.01" inputMode="decimal" required value={f.amount} onChange={set('amount')} />
          </Field>
          <Field label={t('paidAt')}><input className="input" type="date" required max={todayIso()} value={f.paidAt} onChange={set('paidAt')} /></Field>
          <Field label={t('method')}>
            <select className="input" value={f.method} onChange={(e) => setF((p) => ({ ...p, method: e.target.value as PaymentMethod, verify: false, cashReceivedInPerson: false }))}>{METHODS.map((m) => <option key={m} value={m}>{t(m)}</option>)}</select>
          </Field>
          <Field label={t('reference')}><input className="input" value={f.referenceNumber} onChange={set('referenceNumber')} placeholder="eSewa/Khalti/bank ref" /></Field>
          <Field label={t('receipt')} className="col-span-2" hint="JPG / PNG / WEBP / PDF, max 5 MB">
            <input className="input file:mr-2 file:rounded-lg file:border-0 file:bg-brand-50 file:px-2 file:py-1 file:text-brand-700" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label={t('proofUrl')} className="col-span-2"><input className="input" type="url" value={f.proofUrl} onChange={set('proofUrl')} placeholder="https://" /></Field>
          <Field label={t('notes')} className="col-span-2"><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} required={f.type === 'MANUAL_ADJUSTMENT'} /></Field>
          {isManager && f.method === 'CASH' && !hasProof && f.type !== 'MANUAL_ADJUSTMENT' && (
            <div className="col-span-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <p>{t('cashReceiptPolicy')}</p>
              <label className="flex items-start gap-2 font-semibold">
                <input type="checkbox" className="mt-1" checked={f.cashReceivedInPerson} onChange={(e) => setF((p) => ({ ...p, cashReceivedInPerson: e.target.checked }))} />
                <span>{t('cashReceivedConfirm')}</span>
              </label>
            </div>
          )}
          {isManager && hasProof && (
            <label className={`col-span-2 flex items-center gap-2 text-sm ${hasProof ? '' : 'opacity-50'}`}>
              <input type="checkbox" checked={f.verify && hasProof} disabled={!hasProof} onChange={set('verify')} /> {t('verifyNow')}
            </label>
          )}
        </div>
        <ErrorText error={error} />
        <button className="btn-primary w-full" disabled={busy || (!isManager && !hasProof)}>{t('submit')}</button>
        <p className="text-center text-[11px] text-stone-500">{t('noMoneyNotice')}</p>
      </form>
    </Modal>
  );
}
