import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGroup } from '../components/GroupLayout';
import { api, openBlob } from '../lib/api';
import { useAction, useApi } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { date, dateTime, npr, num, toPaisa } from '../lib/format';
import { Alert, Badge, Empty, ErrorText, Field, Modal, Section, Spinner } from '../components/ui';
import { PaymentModal } from '../components/PaymentModal';
import { ENTRY_TYPES, type Entry, type Member, type Round } from '../lib/types';

interface Dispute {
  id: string; entryId: string; reason: string; status: string; outcome: string | null; resolution: string | null; createdAt: string; resolvedAt: string | null;
  correctionEntryId: string | null; entry: Entry;
}

type ActionKind = 'reject' | 'correct' | 'dispute' | 'proof';

export function LedgerPage() {
  const { group, isManager, myMemberId, myRole } = useGroup();
  const { t } = useI18n();
  const [sp, setSp] = useSearchParams();
  const filters = ['memberId', 'roundId', 'type', 'status', 'from', 'to'] as const;
  const qs = new URLSearchParams();
  filters.forEach((k) => sp.get(k) && qs.set(k, sp.get(k)!));
  qs.set('pageSize', '200');
  const list = useApi<{ total: number; entries: Entry[] }>(`/groups/${group.id}/transactions?${qs}`);
  const members = useApi<{ members: Member[] }>(`/groups/${group.id}/members`);
  const rounds = useApi<{ rounds: Round[] }>(`/groups/${group.id}/rounds`);
  const disputes = useApi<{ disputes: Dispute[] }>(`/groups/${group.id}/disputes`);
  const [recording, setRecording] = useState(false);
  const [action, setAction] = useState<{ kind: ActionKind; entry: Entry } | null>(null);
  const [resolving, setResolving] = useState<Dispute | null>(null);
  const act = useAction();
  const cur = group.currency;
  const setFilter = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const reloadAll = () => { list.reload(); disputes.reload(); };
  const roundNo = (id: string | null) => rounds.data?.rounds.find((r) => r.id === id)?.roundNumber;
  const canSubmit = myRole !== 'VIEWER' && (group.status === 'ACTIVE' || group.status === 'SETTLEMENT');

  const actions = (e: Entry) => {
    const own = e.memberId === myMemberId;
    const canSeeReceipt = (isManager || own) && e.hasReceipt;
    return (
      <div className="flex flex-wrap justify-end gap-1">
        {canSeeReceipt && <button className="btn-secondary btn-sm" title={t('viewReceipt')} onClick={() => act.run(() => openBlob(`/groups/${group.id}/transactions/${e.id}/receipt`))}>🧾</button>}
        {(isManager || own) && e.proofUrl && <a className="btn-secondary btn-sm" href={e.proofUrl} target="_blank" rel="noreferrer">🔗</a>}
        {e.status === 'PENDING' && (isManager || own) && !e.hasReceipt && !e.proofUrl && <button className="btn-secondary btn-sm" onClick={() => setAction({ kind: 'proof', entry: e })}>📎</button>}
        {isManager && e.status === 'PENDING' && (
          <>
            {e.method === 'CASH' && !e.hasReceipt && !e.proofUrl && ['CONTRIBUTION', 'LATE_FEE', 'PENALTY'].includes(e.type) ? (
              <button className="btn-primary btn-sm" disabled={act.busy}
                onClick={() => window.confirm(t('cashReceivedConfirm')) && act.run(async () => { await api.post(`/groups/${group.id}/transactions/${e.id}/verify`, { cashReceivedInPerson: true }); reloadAll(); })}>{t('confirmCashReceived')}</button>
            ) : (e.hasReceipt || e.proofUrl) && (
              <button className="btn-primary btn-sm" disabled={act.busy}
                onClick={() => act.run(async () => { await api.post(`/groups/${group.id}/transactions/${e.id}/verify`, {}); reloadAll(); })}>{t('verify')}</button>
            )}
            <button className="btn-secondary btn-sm" onClick={() => setAction({ kind: 'reject', entry: e })}>{t('reject')}</button>
          </>
        )}
        {isManager && e.status === 'VERIFIED' && e.type !== 'CORRECTION' && <button className="btn-secondary btn-sm" onClick={() => setAction({ kind: 'correct', entry: e })}>{t('correction')}</button>}
        {(isManager || own) && myRole !== 'VIEWER' && e.status !== 'REJECTED' && <button className="btn-secondary btn-sm" onClick={() => setAction({ kind: 'dispute', entry: e })}>{t('dispute')}</button>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Section title={t('ledger')} action={canSubmit && <button className="btn-primary btn-sm" onClick={() => setRecording(true)}>+ {isManager ? t('recordPayment') : t('uploadProof')}</button>}>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <select className="input" value={sp.get('memberId') ?? ''} onChange={(e) => setFilter('memberId', e.target.value)} aria-label={t('member')}>
            <option value="">{t('allMembers')}</option>
            {members.data?.members.filter((m) => m.isContributor).map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
          </select>
          <select className="input" value={sp.get('roundId') ?? ''} onChange={(e) => setFilter('roundId', e.target.value)} aria-label={t('round')}>
            <option value="">{t('allRounds')}</option>
            {rounds.data?.rounds.filter((r) => r.status !== 'UPCOMING').map((r) => <option key={r.id} value={r.id}>{t('round')} {num(r.roundNumber)}</option>)}
          </select>
          <select className="input" value={sp.get('type') ?? ''} onChange={(e) => setFilter('type', e.target.value)} aria-label={t('type')}>
            <option value="">{t('allTypes')}</option>
            {ENTRY_TYPES.map((x) => <option key={x} value={x}>{t(x)}</option>)}
          </select>
          <select className="input" value={sp.get('status') ?? ''} onChange={(e) => setFilter('status', e.target.value)} aria-label={t('status')}>
            <option value="">{t('allStatuses')}</option>
            {['PENDING', 'VERIFIED', 'REJECTED'].map((x) => <option key={x} value={x}>{t(x)}</option>)}
          </select>
          <input className="input" type="date" value={sp.get('from') ?? ''} onChange={(e) => setFilter('from', e.target.value)} aria-label={t('from')} title={t('from')} />
          <input className="input" type="date" value={sp.get('to') ?? ''} onChange={(e) => setFilter('to', e.target.value)} aria-label={t('to')} title={t('to')} />
        </div>
        <p className="mb-2 text-xs text-stone-500">{t('immutableNote')}</p>
        <ErrorText error={act.error} />
        {!list.data ? <Spinner /> : list.data.entries.length === 0 ? <Empty /> : (
          <>
          <ul className="divide-y divide-stone-100 sm:hidden">
            {list.data.entries.map((e) => (
              <li key={e.id} className="py-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">#{num(e.seq)} · {e.memberName}</div>
                    <div className="text-xs text-stone-500">{t(e.type)}{roundNo(e.roundId) ? ` · ${t('round')} ${num(roundNo(e.roundId)!)}` : ''} · {date(e.paidAt)} · {t(e.method)}{e.cashReceivedInPerson ? ` · ${t('cashConfirmedLabel')}` : ''}{e.referenceNumber ? ` · ${e.referenceNumber}` : ''}</div>
                    {e.rejectedReason && <div className="text-xs text-red-700">{e.rejectedReason}</div>}
                    {e.notes && <div className="text-xs text-stone-500">{e.notes}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`font-bold ${e.type === 'POT_PAYOUT' || e.type === 'REFUND' || e.amount < 0 ? 'text-red-700' : ''}`}>{npr(e.amount, cur)}</div>
                    <Badge status={e.status} />
                  </div>
                </div>
                <div className="mt-2">{actions(e)}</div>
              </li>
            ))}
          </ul>
          <div className="table-wrap hidden sm:block">
            <table className="data">
              <thead><tr><th>#</th><th>{t('paidAt')}</th><th>{t('member')}</th><th>{t('type')}</th><th className="text-right">{t('amount')}</th><th>{t('method')}</th><th>{t('status')}</th><th /></tr></thead>
              <tbody>
                {list.data.entries.map((e) => {
                  return (
                    <tr key={e.id}>
                      <td className="text-stone-500">{num(e.seq)}</td>
                      <td className="whitespace-nowrap">{date(e.paidAt)}</td>
                      <td>{e.memberName}{roundNo(e.roundId) && <div className="text-[11px] text-stone-500">{t('round')} {num(roundNo(e.roundId)!)}</div>}</td>
                      <td>{t(e.type)}{e.correctsEntryId && <div className="text-[11px] text-stone-500">↳ {list.data!.entries.find((x) => x.id === e.correctsEntryId) ? `#${num(list.data!.entries.find((x) => x.id === e.correctsEntryId)!.seq)}` : ''}</div>}</td>
                      <td className={`whitespace-nowrap text-right font-semibold ${e.type === 'POT_PAYOUT' || e.type === 'REFUND' || e.amount < 0 ? 'text-red-700' : ''}`}>{npr(e.amount, cur)}</td>
                      <td>{t(e.method)}{e.cashReceivedInPerson && <div className="text-[11px] font-semibold text-emerald-800">{t('cashConfirmedLabel')}</div>}{e.referenceNumber && <div className="text-[11px] text-stone-500">{e.referenceNumber}</div>}</td>
                      <td><Badge status={e.status} />{e.rejectedReason && <div className="max-w-[160px] text-[11px] text-red-700">{e.rejectedReason}</div>}{e.notes && <div className="max-w-[160px] text-[11px] text-stone-500">{e.notes}</div>}</td>
                      <td className="whitespace-nowrap text-right">
                        {actions(e)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
        {list.data && <p className="mt-2 text-xs text-stone-500">{num(list.data.total)} {t('transaction').toLowerCase()}</p>}
      </Section>

      <div id="disputes">
        <Section title={t('disputes')}>
          {!disputes.data ? <Spinner /> : disputes.data.disputes.length === 0 ? <Empty /> : (
            <ul className="divide-y divide-stone-100">
              {disputes.data.disputes.map((d) => (
                <li key={d.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">#{num(d.entry.seq)} · {d.entry.memberName} · {t(d.entry.type)} {npr(d.entry.amount, cur)}</div>
                    <div className="flex items-center gap-2">
                      <Badge status={d.status} />
                      {d.outcome && <Badge tone={d.outcome === 'UPHELD' ? 'green' : 'gray'} label={d.outcome} />}
                      {isManager && d.status === 'OPEN' && <button className="btn-primary btn-sm" onClick={() => setResolving(d)}>{t('resolve')}</button>}
                    </div>
                  </div>
                  <p className="mt-1 text-stone-700">“{d.reason}” <span className="text-xs text-stone-400">{dateTime(d.createdAt)}</span></p>
                  {d.resolution && <p className="mt-1 rounded-lg bg-stone-100 px-2 py-1 text-stone-700">↳ {d.resolution} <span className="text-xs text-stone-400">{dateTime(d.resolvedAt)}</span></p>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {recording && members.data && rounds.data && (
        <PaymentModal open onClose={() => setRecording(false)} onDone={reloadAll} groupId={group.id} isManager={isManager} myMemberId={myMemberId}
          members={members.data.members} rounds={rounds.data.rounds} currency={cur} />
      )}
      {action && <EntryActionModal kind={action.kind} entry={action.entry} groupId={group.id} currency={cur} onClose={() => setAction(null)} onDone={reloadAll} />}
      {resolving && <ResolveModal dispute={resolving} groupId={group.id} currency={cur} onClose={() => setResolving(null)} onDone={reloadAll} />}
    </div>
  );
}

function EntryActionModal({ kind, entry, groupId, currency, onClose, onDone }: { kind: ActionKind; entry: Entry; groupId: string; currency: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const { busy, error, run } = useAction();
  const titles: Record<ActionKind, string> = { reject: t('reject'), correct: t('correction'), dispute: t('dispute'), proof: t('uploadProof') };
  const base = `/groups/${groupId}/transactions/${entry.id}`;
  const submit = () => run(async () => {
    if (kind === 'reject') await api.post(`${base}/reject`, { reason: text });
    if (kind === 'correct') await api.post(`${base}/corrections`, { amount: toPaisa(amount), reason: text });
    if (kind === 'dispute') await api.post(`${base}/disputes`, { reason: text });
    if (kind === 'proof') await api.form(`${base}/proof`, { proofUrl: url }, file);
    window.dispatchEvent(new Event('dhukuti:notifications'));
    onDone();
    onClose();
  });
  const valid = kind === 'proof' ? !!file || !!url : kind === 'correct' ? text.trim().length >= 5 && amount !== '' && Number(amount) !== 0 : text.trim().length >= (kind === 'reject' ? 3 : 5);
  return (
    <Modal open onClose={onClose} title={`${titles[kind]} · #${entry.seq}`}>
      <div className="space-y-3">
        <div className="rounded-xl bg-stone-100 p-3 text-sm">{entry.memberName} · {t(entry.type)} · <b>{npr(entry.amount, currency)}</b> · {date(entry.paidAt)} <Badge status={entry.status} /></div>
        {kind === 'correct' && (
          <>
            <Alert tone="blue">A new CORRECTION entry is added; the original stays unchanged. Use a negative amount to reduce. / मूल प्रविष्टि नबदली नयाँ सुधार प्रविष्टि थपिन्छ।</Alert>
            <Field label={`${t('amount')} (${currency}, + / −)`}><input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          </>
        )}
        {kind === 'proof' ? (
          <>
            <Field label={t('receipt')}><input className="input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
            <Field label={t('proofUrl')}><input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
          </>
        ) : (
          <Field label={t('reason')}><textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        )}
        <ErrorText error={error} />
        <button className={kind === 'reject' ? 'btn-danger w-full' : 'btn-primary w-full'} disabled={busy || !valid} onClick={submit}>{t('submit')}</button>
      </div>
    </Modal>
  );
}

function ResolveModal({ dispute, groupId, currency, onClose, onDone }: { dispute: Dispute; groupId: string; currency: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [outcome, setOutcome] = useState<'UPHELD' | 'DISMISSED'>('DISMISSED');
  const [resolution, setResolution] = useState('');
  const [amount, setAmount] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal open onClose={onClose} title={`${t('resolve')} · #${dispute.entry.seq}`}>
      <div className="space-y-3">
        <div className="rounded-xl bg-stone-100 p-3 text-sm">“{dispute.reason}”<div className="mt-1 text-xs text-stone-500">{dispute.entry.memberName} · {t(dispute.entry.type)} · {npr(dispute.entry.amount, currency)}</div></div>
        <div className="grid grid-cols-2 gap-2">
          {(['UPHELD', 'DISMISSED'] as const).map((o) => (
            <button key={o} type="button" onClick={() => setOutcome(o)} className={`rounded-xl border-2 p-2 text-sm font-semibold ${outcome === o ? 'border-brand-600 bg-brand-50' : 'border-stone-200'}`}>
              {o === 'UPHELD' ? 'Upheld / मान्य' : 'Dismissed / अमान्य'}
            </button>
          ))}
        </div>
        {outcome === 'UPHELD' && <Field label={`${t('correction')} (${currency}, + / −, optional)`}><input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
        <Field label="Resolution / समाधान"><textarea className="input" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>
        <ErrorText error={error} />
        <button className="btn-primary w-full" disabled={busy || resolution.trim().length < 5}
          onClick={() => run(async () => {
            await api.post(`/groups/${groupId}/disputes/${dispute.id}/resolve`, { outcome, resolution, ...(outcome === 'UPHELD' && amount && Number(amount) !== 0 ? { correctionAmount: toPaisa(amount) } : {}) });
            onDone();
            onClose();
          })}>{t('resolve')}</button>
      </div>
    </Modal>
  );
}
