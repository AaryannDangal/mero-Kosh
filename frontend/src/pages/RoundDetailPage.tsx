import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useGroup } from '../components/GroupLayout';
import { api, download, openBlob } from '../lib/api';
import { useAction, useApi } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { date, dateTime, fromPaisa, npr, num, toPaisa, todayIso, whatsappLink } from '../lib/format';
import { Alert, Badge, ErrorText, Field, Section, Spinner, Stat } from '../components/ui';
import { PaymentModal, type PaymentDefaults } from '../components/PaymentModal';
import { METHODS, type Member, type PaymentMethod, type Reconciliation, type Round } from '../lib/types';

interface ChecklistRow {
  memberId: string; fullName: string; isWinner: boolean; contributionDue: number; discountCredit: number; amountDue: number; paid: number;
  pending?: number; outstanding: number; status: string; lateFeeAssessed?: number; lateFeeOutstanding?: number; daysLate: number;
}
interface RoundDetail {
  round: Round;
  checklist: ChecklistRow[];
  bids: {
    revealed: boolean; count: number; limits: { minDiscount: number; maxDiscount: number } | null;
    items: { memberId: string; fullName: string; isWinning: boolean; discountAmount: number | null; submittedAt: string | null }[];
    myBid: { discountAmount: number; submittedAt: string } | null;
  };
  payout: { id: string; seq: number; amount: number; status: string; method: string; paidAt: string; referenceNumber?: string; hasReceipt: boolean } | null;
  reconciliation: Reconciliation | null;
  eligibleWinners: { memberId: string; fullName: string }[];
  potRequests: { memberId: string; fullName: string; createdAt: string; isMe: boolean }[];
  myPotRequest: boolean;
  canRequestPot: boolean;
}

export function RoundDetailPage() {
  const { roundId } = useParams();
  const g = useGroup();
  const { group, isManager, isReader, myMemberId } = g;
  const { t } = useI18n();
  const { data, reload } = useApi<RoundDetail>(`/groups/${group.id}/rounds/${roundId}`);
  const members = useApi<{ members: Member[] }>(`/groups/${group.id}/members`);
  const rounds = useApi<{ rounds: Round[] }>(`/groups/${group.id}/rounds`);
  const [pay, setPay] = useState<PaymentDefaults | null>(null);
  const exp = useAction();
  useEffect(() => {
    if (data?.round.selectionMethod !== 'ADMIN_SELECTION') return;
    const refresh = window.setInterval(() => { void reload(); }, 20000);
    return () => window.clearInterval(refresh);
  }, [data?.round.selectionMethod, reload]);
  if (!data) return <Spinner />;
  const { round: r, checklist } = data;
  const cur = group.currency;
  const open = ['COLLECTING', 'PAYOUT_PENDING', 'DISPUTED'].includes(r.status);
  const memberPhone = (id: string) => members.data?.members.find((m) => m.id === id)?.phone;
  const reloadAll = () => { reload(); rounds.reload(); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to=".." relative="path" className="text-sm text-brand-600">← {t('rounds')}</Link>
        <h2 className="text-lg font-bold">{t('round')} {num(r.roundNumber)} · {r.periodLabel}</h2>
        <Badge status={r.status} />
        {r.biddingStatus !== 'NOT_APPLICABLE' && <Badge status={r.biddingStatus} label={`${t('bidding')}: ${t(r.biddingStatus)}`} />}
        <div className="flex-1" />
        <button className="btn-secondary btn-sm" disabled={exp.busy} onClick={() => exp.run(() => download(`/groups/${group.id}/reports/rounds/${r.id}?format=csv`, `round-${r.roundNumber}.csv`))}>CSV</button>
        <button className="btn-secondary btn-sm" disabled={exp.busy} onClick={() => exp.run(() => download(`/groups/${group.id}/reports/rounds/${r.id}?format=pdf`, `round-${r.roundNumber}.pdf`))}>PDF</button>
      </div>
      <ErrorText error={exp.error} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('fullPot')} value={npr(r.fullPot ?? group.contributionAmount * group.memberCount, cur)} sub={r.contributorCount ? `${npr(group.contributionAmount, cur)} × ${num(r.contributorCount)}` : undefined} />
        <Stat label={t('winner')} value={r.winnerName ?? r.plannedRecipient ?? '—'} sub={r.selectionOverrideReason ? `${t('override')}: ${r.selectionOverrideReason}` : undefined} />
        <Stat label={t('bidDiscount')} value={npr(r.bidDiscount, cur)} sub={r.discountRecipientCount ? `${t('sharePerMember')}: ${npr(r.discountSharePerMember, cur)} × ${num(r.discountRecipientCount)}` : undefined} />
        <Stat label={t('payoutToWinner')} value={npr(r.payoutToWinner ?? r.fullPot, cur)} tone="green" />
        <Stat label={t('expectedCollection')} value={npr(r.expectedCollection, cur)} />
        <Stat label={t('actualCollection')} value={npr(data.reconciliation?.flows.contributions ?? r.actualCollection, cur)} />
        <Stat label={t('openingBalance')} value={npr(r.openingBalance, cur)} />
        <Stat label={t('dueDate')} value={date(r.dueDate)} sub={`${t('gracePeriod')}: ${num(group.gracePeriodDays)}`} />
      </div>

      {r.selectionMethod === 'BIDDING' && r.status !== 'UPCOMING' && <BiddingPanel d={data} onChange={reloadAll} />}
      {r.selectionMethod === 'ADMIN_SELECTION' && <PotRequestsPanel d={data} onChange={reloadAll} />}

      <Section title={t('checklist')}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{t('member')}</th><th>{t('amountDue')}</th><th>{t('PAID')}</th><th>{t('outstanding')}</th><th>{t('status')}</th><th>{t('lateFee')}</th><th /></tr></thead>
            <tbody>
              {checklist.map((c) => {
                const wa = isManager && c.outstanding > 0 ? whatsappLink(memberPhone(c.memberId), `Namaste ${c.fullName}, ${group.name} ${t('round')} ${r.roundNumber}: ${npr(c.outstanding + (c.lateFeeOutstanding ?? 0), cur)} ${t('outstanding').toLowerCase()} (${t('dueDate')} ${date(r.dueDate)}). 🙏`) : null;
                return (
                  <tr key={c.memberId} className={c.memberId === myMemberId ? 'bg-brand-50/50' : ''}>
                    <td className="font-medium">{c.fullName}{c.isWinner && ' 🏆'}</td>
                    <td>{npr(c.amountDue, cur)}{c.discountCredit > 0 && <div className="text-[11px] text-emerald-700">−{npr(c.discountCredit, cur)} {t('bidDiscount').toLowerCase()}</div>}</td>
                    <td>{npr(c.paid, cur)}{!!c.pending && <div className="text-[11px] text-amber-700">+{npr(c.pending, cur)} {t('PENDING').toLowerCase()}</div>}</td>
                    <td className={c.outstanding ? 'font-semibold text-red-700' : ''}>{npr(c.outstanding, cur)}</td>
                    <td><Badge status={c.status} />{c.daysLate > 0 && <div className="text-[11px] text-stone-500">{num(c.daysLate)}d</div>}</td>
                    <td>{c.lateFeeAssessed ? <>{npr(c.lateFeeAssessed, cur)}{!!c.lateFeeOutstanding && <div className="text-[11px] text-red-700">{t('outstanding')}: {npr(c.lateFeeOutstanding, cur)}</div>}</> : '—'}</td>
                    <td className="whitespace-nowrap text-right">
                      {open && (isManager || c.memberId === myMemberId) && (c.outstanding > 0 || (c.lateFeeOutstanding ?? 0) > 0) && (
                        <button className="btn-secondary btn-sm" onClick={() => setPay(c.outstanding > 0
                          ? { memberId: c.memberId, roundId: r.id, type: 'CONTRIBUTION', amount: c.outstanding - (c.pending ?? 0) > 0 ? c.outstanding - (c.pending ?? 0) : undefined }
                          : { memberId: c.memberId, roundId: r.id, type: 'LATE_FEE', amount: c.lateFeeOutstanding })}>
                          {isManager ? t('recordPayment') : t('uploadProof')}
                        </button>
                      )}
                      {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-secondary btn-sm ml-1">💬</a>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {isManager && open && r.selectionMethod !== 'ADMIN_SELECTION' && <OverridePanel d={data} onChange={reloadAll} />}
      {open || data.payout ? <PayoutPanel d={data} onChange={reloadAll} /> : null}
      {(isReader || r.status === 'COMPLETED') && data.reconciliation && <ReconciliationPanel d={data} onChange={reloadAll} />}

      {pay && members.data && rounds.data && (
        <PaymentModal open onClose={() => setPay(null)} onDone={reloadAll} groupId={group.id} isManager={isManager} myMemberId={myMemberId}
          defaults={pay} members={members.data.members} rounds={rounds.data.rounds} currency={cur} />
      )}
    </div>
  );
}

function PotRequestsPanel({ d, onChange }: { d: RoundDetail; onChange: () => void }) {
  const { group, isManager, myMemberId, myRole } = useGroup();
  const { t } = useI18n();
  const { round: r } = d;
  const { busy, error, run } = useAction();
  const [selectingMemberId, setSelectingMemberId] = useState<string | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const requestsOpen = !r.winnerMemberId && ['COLLECTING', 'PAYOUT_PENDING'].includes(r.status);
  const canRequest = d.canRequestPot && requestsOpen && myRole !== 'VIEWER';
  const eligibleIds = new Set(d.eligibleWinners.map((member) => member.memberId));
  const canAllocate = isManager && ['COLLECTING', 'PAYOUT_PENDING'].includes(r.status) && !r.payoutEntryId;
  const requestedPotAmount = r.fullPot ?? group.contributionAmount * group.memberCount;
  return (
    <Section title={`${t('potRequests')} (${num(d.potRequests.length)})`}>
      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-950">{t('potRequestVisibility')} <span className="font-medium">{t('potRequestLiveRefresh')}</span></div>
      {d.potRequests.length ? (
        <ul className="mb-3 divide-y divide-stone-100">
          {d.potRequests.map((request, index) => (
            <li key={request.memberId} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold">{index + 1}. {request.fullName}{request.isMe ? ` · ${t('you')}` : ''}</span>
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800">{t('requestedPotAmount')}: {npr(requestedPotAmount, group.currency)}</span>
                  </div>
                  <div className="text-xs text-stone-500">{dateTime(request.createdAt)}</div>
                </div>
                {canAllocate && eligibleIds.has(request.memberId) && (r.winnerMemberId === request.memberId ? (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">{t('selectedRecipient')}</span>
                ) : (
                  <button
                    className="btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => {
                      setSelectingMemberId(selectingMemberId === request.memberId ? null : request.memberId);
                      setDecisionReason('');
                    }}
                  >
                    {selectingMemberId === request.memberId ? t('cancel') : r.winnerMemberId ? t('changeRecipient') : t('selectRequester')}
                  </button>
                ))}
                {canAllocate && !eligibleIds.has(request.memberId) && (
                  <span className="text-xs text-stone-500">{t('requesterNotEligible')}</span>
                )}
              </div>
              {canAllocate && selectingMemberId === request.memberId && (
                <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <Field label={t('decisionReason')}>
                    <textarea
                      className="input mt-1"
                      rows={2}
                      value={decisionReason}
                      onChange={(e) => setDecisionReason(e.target.value)}
                      aria-label={`${t('decisionReason')}: ${request.fullName}`}
                      autoFocus
                    />
                  </Field>
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                    <button className="btn-secondary btn-sm" disabled={busy} onClick={() => { setSelectingMemberId(null); setDecisionReason(''); }}>{t('cancel')}</button>
                    <button
                      className="btn-primary btn-sm"
                      disabled={busy || decisionReason.trim().length < 5}
                      onClick={() => run(async () => {
                        await api.post(`/groups/${group.id}/rounds/${r.id}/winner-override`, { memberId: request.memberId, reason: decisionReason.trim() });
                        setSelectingMemberId(null);
                        setDecisionReason('');
                        onChange();
                      })}
                    >{busy ? t('saving') : t('confirmRecipient')}</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="mb-3 text-sm text-stone-500">{t('noPotRequests')}</p>}
      {canRequest && (
        <div className="flex flex-wrap gap-2">
          <button className={d.myPotRequest ? 'btn-secondary' : 'btn-primary'} disabled={busy} onClick={() => run(async () => {
            if (d.myPotRequest) await api.del(`/groups/${group.id}/rounds/${r.id}/requests/me`);
            else await api.post(`/groups/${group.id}/rounds/${r.id}/requests/me`);
            onChange();
          })}>{d.myPotRequest ? t('withdrawPotRequest') : t('requestPot')}</button>
          {d.myPotRequest && <span className="self-center text-xs text-emerald-700">{t('requestSubmitted')}</span>}
        </div>
      )}
      {!canRequest && d.myPotRequest && r.winnerMemberId && (
        <p className="text-sm font-medium text-emerald-800" role="status">
          {r.winnerMemberId === myMemberId ? t('youSelectedForPot') : t('requestNotSelected').replace('{name}', r.winnerName ?? t('selectedRecipient'))}
        </p>
      )}
      {isManager && ['COLLECTING', 'PAYOUT_PENDING'].includes(r.status) && <p className="mt-2 text-xs text-stone-500">{t('adminSelectionHint')}</p>}
      <ErrorText error={error} />
    </Section>
  );
}

function BiddingPanel({ d, onChange }: { d: RoundDetail; onChange: () => void }) {
  const { group, isManager, myMemberId, myRole } = useGroup();
  const { t } = useI18n();
  const { round: r, bids } = d;
  const [amount, setAmount] = useState(bids.myBid ? fromPaisa(bids.myBid.discountAmount) : '');
  const { busy, error, run } = useAction();
  const cur = group.currency;
  const isRecipientCandidate = d.checklist.some((c) => c.memberId === myMemberId) && myRole !== 'VIEWER';
  const amt = toPaisa(amount || '0');
  const sharePreview = r.fullPot && amount ? amt : null;
  return (
    <Section title={t('bidding')}>
      {bids.revealed ? (
        <>
          <h3 className="mb-2 text-sm font-semibold">{t('bidsRevealed')} ({num(bids.count)})</h3>
          {bids.items.length === 0 ? <p className="text-sm text-stone-500">No bids — the recipient was assigned automatically. / कुनै बोल परेन।</p> : (
            <ul className="divide-y divide-stone-100">
              {[...bids.items].sort((a, b) => (b.discountAmount ?? 0) - (a.discountAmount ?? 0)).map((b) => (
                <li key={b.memberId} className={`flex items-center justify-between py-2 text-sm ${b.isWinning ? 'font-bold text-emerald-700' : ''}`}>
                  <span>{b.isWinning && '🏆 '}{b.fullName}</span>
                  <span>{npr(b.discountAmount, cur)} <span className="ml-2 text-xs font-normal text-stone-500">{dateTime(b.submittedAt)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : r.biddingStatus === 'OPEN' ? (
        <div className="space-y-3">
          <Alert tone="blue">🔒 {t('bidsSealed')} {t('bidExplainer')}</Alert>
          <div className="text-sm">Bids submitted / परेका बोल: <b>{num(bids.count)}</b>{isManager && bids.items.length > 0 && <span className="text-stone-500"> — {bids.items.map((b) => b.fullName).join(', ')}</span>}</div>
          {bids.limits && <div className="text-xs text-stone-500">Min {npr(bids.limits.minDiscount, cur)} · Max {npr(bids.limits.maxDiscount, cur)}</div>}
          {isRecipientCandidate && (
            <div className="rounded-xl border border-stone-200 p-3">
              <Field label={`${t('yourBid')} (${cur})`} hint={sharePreview != null && r.fullPot ? `${t('payoutToWinner')}: ${npr(r.fullPot - amt, cur)}` : undefined}>
                <input className="input" type="number" step="0.01" min={bids.limits ? bids.limits.minDiscount / 100 : 0} max={bids.limits ? bids.limits.maxDiscount / 100 : undefined} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              {bids.myBid && <p className="mt-1 text-xs text-stone-500">{t('yourBid')}: {npr(bids.myBid.discountAmount, cur)} · {dateTime(bids.myBid.submittedAt)}</p>}
              <div className="mt-2 flex gap-2">
                <button className="btn-primary flex-1" disabled={busy || !amount} onClick={() => run(async () => { await api.put(`/groups/${group.id}/rounds/${r.id}/bids/me`, { discountAmount: amt }); onChange(); })}>{t('submitBid')}</button>
                {bids.myBid && <button className="btn-secondary" disabled={busy} onClick={() => run(async () => { await api.del(`/groups/${group.id}/rounds/${r.id}/bids/me`); setAmount(''); onChange(); })}>{t('withdraw')}</button>}
              </div>
            </div>
          )}
          {isManager && (
            <button className="btn-primary w-full" disabled={busy} onClick={() => confirm(t('closeBidding') + '?') && run(async () => { await api.post(`/groups/${group.id}/rounds/${r.id}/bids/close`); onChange(); })}>{t('closeBidding')}</button>
          )}
          <ErrorText error={error} />
        </div>
      ) : <p className="text-sm text-stone-500">{t(r.biddingStatus)}</p>}
    </Section>
  );
}

function OverridePanel({ d, onChange }: { d: RoundDetail; onChange: () => void }) {
  const { group } = useGroup();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [reason, setReason] = useState('');
  const [discount, setDiscount] = useState('');
  const { busy, error, run } = useAction();
  if (d.round.payoutEntryId) return null;
  return (
    <Section title={t('override')} action={<button className="btn-secondary btn-sm" onClick={() => setOpen(!open)}>{open ? '−' : '+'}</button>}>
      {open && (
        <div className="space-y-3">
          <Alert>Overrides are recorded in the audit log with your reason. Members with unpaid contributions or who already received the pot cannot be selected. / सबै परिवर्तन अडिट लगमा रहन्छ।</Alert>
          <Field label={t('winner')}>
            <select className="input" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">—</option>
              {d.eligibleWinners.map((w) => <option key={w.memberId} value={w.memberId}>{w.fullName}</option>)}
            </select>
          </Field>
          {group.selectionMethod === 'BIDDING' && <Field label={`${t('bidDiscount')} (${group.currency})`}><input className="input" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>}
          <Field label={t('overrideReason')}><textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <ErrorText error={error} />
          <button className="btn-danger w-full" disabled={busy || !memberId || reason.trim().length < 5}
            onClick={() => run(async () => {
              await api.post(`/groups/${group.id}/rounds/${d.round.id}/winner-override`, { memberId, reason, ...(discount !== '' ? { bidDiscount: toPaisa(discount) } : {}) });
              setOpen(false); setReason(''); onChange();
            })}>{t('confirm')}</button>
        </div>
      )}
    </Section>
  );
}

function PayoutPanel({ d, onChange }: { d: RoundDetail; onChange: () => void }) {
  const { group, isManager } = useGroup();
  const { t } = useI18n();
  const r = d.round;
  const [f, setF] = useState({ amount: r.payoutToWinner != null ? fromPaisa(r.payoutToWinner) : '', method: 'BANK_TRANSFER' as PaymentMethod, referenceNumber: '', paidAt: todayIso(), notes: '', proofUrl: '', verify: true });
  const [file, setFile] = useState<File | null>(null);
  const { busy, error, run } = useAction();
  useEffect(() => { if (r.payoutToWinner != null) setF((p) => ({ ...p, amount: fromPaisa(r.payoutToWinner) })); }, [r.payoutToWinner]);
  const cur = group.currency;
  if (d.payout) {
    return (
      <Section title={t('POT_PAYOUT')}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div>
            <div className="font-semibold">#{num(d.payout.seq)} · {npr(d.payout.amount, cur)} → {r.winnerName}</div>
            <div className="text-xs text-stone-500">{date(d.payout.paidAt)} · {t(d.payout.method)}{d.payout.referenceNumber ? ` · ${d.payout.referenceNumber}` : ''}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge status={d.payout.status} />
            {isManager && d.payout.hasReceipt && <button className="btn-secondary btn-sm" onClick={() => openBlob(`/groups/${group.id}/transactions/${d.payout!.id}/receipt`)}>{t('viewReceipt')}</button>}
            {isManager && d.payout.status === 'PENDING' && <button className="btn-primary btn-sm" disabled={busy} onClick={() => run(async () => { await api.post(`/groups/${group.id}/transactions/${d.payout!.id}/verify`); onChange(); })}>{t('verify')}</button>}
          </div>
        </div>
        <ErrorText error={error} />
      </Section>
    );
  }
  if (!isManager) return null;
  if (!r.winnerMemberId) return <Section title={t('recordPayout')}><p className="text-sm text-stone-500">{r.selectionMethod === 'BIDDING' ? 'Close bidding first. / पहिले बोल बन्द गर्नुहोस्।' : '—'}</p></Section>;
  const hasProof = !!file || !!f.proofUrl;
  const winnerRow = d.checklist.find((c) => c.memberId === r.winnerMemberId);
  return (
    <Section title={`${t('recordPayout')} → ${r.winnerName}`}>
      {winnerRow && winnerRow.outstanding > 0 && (
        <div className="mb-3"><Alert>{r.winnerName} still owes {npr(winnerRow.outstanding, cur)} for this round. The recipient's own contribution must be verified before the payout can be recorded. / प्राप्तकर्ताको योगदान प्रमाणित भएपछि मात्र भुक्तानी रेकर्ड हुन्छ।</Alert></div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${t('amount')} (${cur})`} hint={`= ${t('fullPot')} − ${t('bidDiscount')}`}><input className="input" type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t('paidAt')}><input className="input" type="date" max={todayIso()} value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} /></Field>
        <Field label={t('method')}><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}>{METHODS.map((m) => <option key={m} value={m}>{t(m)}</option>)}</select></Field>
        <Field label={t('reference')}><input className="input" value={f.referenceNumber} onChange={(e) => setF({ ...f, referenceNumber: e.target.value })} /></Field>
        <Field label={t('receipt')} className="col-span-2"><input className="input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Field label={t('proofUrl')} className="col-span-2"><input className="input" type="url" value={f.proofUrl} onChange={(e) => setF({ ...f, proofUrl: e.target.value })} /></Field>
        <label className={`col-span-2 flex items-center gap-2 text-sm ${hasProof ? '' : 'opacity-50'}`}><input type="checkbox" disabled={!hasProof} checked={f.verify && hasProof} onChange={(e) => setF({ ...f, verify: e.target.checked })} />{t('verifyNow')}</label>
      </div>
      <ErrorText error={error} />
      <button className="btn-primary mt-3 w-full" disabled={busy || !f.amount}
        onClick={() => run(async () => {
          await api.form(`/groups/${group.id}/rounds/${r.id}/payout`, { ...f, amount: toPaisa(f.amount), verify: f.verify && hasProof }, file);
          onChange();
        })}>{t('recordPayout')}</button>
      <p className="mt-2 text-center text-[11px] text-stone-500">{t('noMoneyNotice')}</p>
    </Section>
  );
}

function ReconciliationPanel({ d, onChange }: { d: RoundDetail; onChange: () => void }) {
  const { group, isManager } = useGroup();
  const { t } = useI18n();
  const r = d.round;
  const cur = group.currency;
  const [actual, setActual] = useState(r.actualClosingBalance != null ? fromPaisa(r.actualClosingBalance) : '');
  const [preview, setPreview] = useState<Reconciliation | null>(d.reconciliation);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const closable = ['COLLECTING', 'PAYOUT_PENDING'].includes(r.status);
  useEffect(() => {
    if (!closable) return;
    const id = setTimeout(() => {
      const q = actual === '' ? '' : `?actualClosingBalance=${toPaisa(actual)}`;
      api.get<Reconciliation>(`/groups/${group.id}/rounds/${r.id}/reconciliation${q}`).then(setPreview).catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [actual, closable, group.id, r.id]);
  const rec = preview ?? d.reconciliation!;
  const f = rec.flows;
  const mismatch = rec.reconciliation.status === 'MISMATCH';
  const line = (label: string, v: number, sign = '+') => (
    <div className="flex justify-between py-1"><span className="text-stone-600">{sign} {label}</span><span className="font-medium">{npr(v, cur)}</span></div>
  );
  return (
    <Section title={t('reconciliation')} action={<Badge status={r.status === 'COMPLETED' ? r.reconciliationStatus : rec.reconciliation.status} />}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="divide-y divide-stone-100 text-sm">
          {line(t('openingBalance'), r.openingBalance, ' ')}
          {line(t('CONTRIBUTION'), f.contributions)}
          {line(`${t('LATE_FEE')} + ${t('PENALTY')}`, f.lateFees + f.penalties)}
          {line(t('POT_PAYOUT'), f.payouts, '−')}
          {(f.adjustments !== 0 || f.refunds !== 0) && line(`${t('MANUAL_ADJUSTMENT')} − ${t('REFUND')}`, f.adjustments - f.refunds, '±')}
          <div className="flex justify-between py-1.5 font-bold"><span>= {t('calculatedClosing')}</span><span>{npr(rec.reconciliation.calculatedClosingBalance, cur)}</span></div>
          {rec.collectionShortfall > 0 && <div className="py-1 text-xs text-amber-700">Collection shortfall / संकलन कमी: {npr(rec.collectionShortfall, cur)}</div>}
        </div>
        <div className="space-y-3 text-sm">
          {Object.keys(f.byMethod).length > 0 && (
            <div>
              <div className="label">{t('method')}</div>
              {Object.entries(f.byMethod).map(([m, v]) => <div key={m} className="flex justify-between"><span>{t(m)}</span><span>+{npr(v.in, cur)} / −{npr(v.out, cur)}</span></div>)}
            </div>
          )}
          {closable && isManager ? (
            <>
              <Field label={`${t('actualClosing')} (${cur})`} hint="Cash + bank + wallet balance actually held by the organizer / आयोजकसँग रहेको वास्तविक रकम">
                <input className="input" type="number" step="0.01" value={actual} onChange={(e) => setActual(e.target.value)} />
              </Field>
              {rec.reconciliation.difference != null && (
                mismatch
                  ? <Alert tone="red" title="⚠ WARNING / चेतावनी">{rec.reconciliation.warning} ({npr(rec.reconciliation.difference, cur)})</Alert>
                  : <Alert tone="green">✓ {t('BALANCED')}</Alert>
              )}
              {mismatch && <Field label={t('mismatchReason')}><textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
              <ErrorText error={error} />
              <button className="btn-primary w-full" disabled={busy || actual === '' || (mismatch && reason.trim().length < 3)}
                onClick={() => run(async () => { await api.post(`/groups/${group.id}/rounds/${r.id}/close`, { actualClosingBalance: toPaisa(actual), mismatchReason: mismatch ? reason : undefined }); onChange(); })}>
                {t('closeRound')}
              </button>
            </>
          ) : r.status === 'COMPLETED' ? (
            <div className="space-y-1">
              <div className="flex justify-between"><span>{t('actualClosing')}</span><b>{npr(r.actualClosingBalance, cur)}</b></div>
              {r.reconciliationStatus === 'MISMATCH' && <Alert tone="red" title="⚠ WARNING">{t('MISMATCH')}: {npr((r.actualClosingBalance ?? 0) - (r.calculatedClosingBalance ?? 0), cur)}{r.reconciliationNote ? ` — ${r.reconciliationNote}` : ''}</Alert>}
              <div className="text-xs text-stone-500">{dateTime(r.closedAt)}</div>
            </div>
          ) : null}
        </div>
      </div>
    </Section>
  );
}
