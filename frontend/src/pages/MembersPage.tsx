import { useState, type FormEvent } from 'react';
import { useGroup } from '../components/GroupLayout';
import { api } from '../lib/api';
import { useAction, useApi } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { date, npr, num, whatsappLink } from '../lib/format';
import { Alert, Avatar, Badge, ErrorText, Field, Modal, Section, Spinner } from '../components/ui';
import { METHODS, type Member, type PaymentMethod, type Role } from '../lib/types';

type Details = { fullName: string; phone: string; email: string; paymentMethod: PaymentMethod | ''; paymentIdentifier: string; bankName: string; role: Role; rotationOrder: string };
const emptyDetails = (): Details => ({ fullName: '', phone: '', email: '', paymentMethod: '', paymentIdentifier: '', bankName: '', role: 'MEMBER', rotationOrder: '' });

function DetailsFields({ v, set, showRole, showRotation, roleLocked }: { v: Details; set: (k: keyof Details, x: string) => void; showRole: boolean; showRotation: boolean; roleLocked?: boolean }) {
  const { t } = useI18n();
  const inp = (k: keyof Details) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(k, e.target.value) });
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('fullName')} className="col-span-2"><input className="input" required minLength={2} {...inp('fullName')} /></Field>
      <Field label={t('phone')} hint={`${t('phoneRequired')} · ${t('phoneHint')}`}><input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+977 98… or +1 202…" required {...inp('phone')} /></Field>
      <Field label={t('emailOptional')}><input className="input" type="email" {...inp('email')} /></Field>
      <Field label={t('method')}>
        <select className="input" {...inp('paymentMethod')}><option value="">—</option>{METHODS.map((m) => <option key={m} value={m}>{t(m)}</option>)}</select>
      </Field>
      <Field label={t('paymentIdentifier')} hint="No card numbers / कार्ड नम्बर नराख्नुहोस्"><input className="input" {...inp('paymentIdentifier')} /></Field>
      {v.paymentMethod === 'BANK_TRANSFER' && <Field label={t('bankName')} className="col-span-2"><input className="input" {...inp('bankName')} /></Field>}
      {showRole && (
        <Field label={t('role')}>
          <select className="input" disabled={roleLocked} {...inp('role')}>
            {(['MEMBER', 'CO_ORGANIZER', 'VIEWER'] as Role[]).map((r) => <option key={r} value={r}>{t(r)}</option>)}
          </select>
        </Field>
      )}
      {showRotation && v.role !== 'VIEWER' && <Field label={t('rotationOrder')}><input className="input" type="number" min="1" {...inp('rotationOrder')} /></Field>}
    </div>
  );
}

const detailsPayload = (v: Details, opts: { role: boolean; rotation: boolean }) => ({
  fullName: v.fullName, phone: v.phone || null, email: v.email || null, paymentMethod: v.paymentMethod || null,
  paymentIdentifier: v.paymentIdentifier || null, bankName: v.bankName || null,
  ...(opts.role ? { role: v.role } : {}),
  ...(opts.rotation ? { rotationOrder: v.rotationOrder ? Number(v.rotationOrder) : null } : {}),
});

export function MembersPage() {
  const { group, isManager, myMemberId, myRole } = useGroup();
  const { t } = useI18n();
  const { data, reload } = useApi<{ members: Member[] }>(`/groups/${group.id}/members`);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [statusFor, setStatusFor] = useState<Member | null>(null);
  const [exitFor, setExitFor] = useState<Member | null>(null);
  const draft = group.status === 'DRAFT';
  if (!data) return <Spinner />;
  const seats = data.members.filter((m) => m.isContributor && m.status !== 'EXITED').length;
  return (
    <div className="space-y-4">
      <Section title={`${t('members')} (${num(seats)}/${num(group.memberCount)})`} action={isManager && <button className="btn-primary btn-sm" onClick={() => setAdding(true)}>+ {t('addMember')}</button>}>
        <ul className="divide-y divide-stone-100">
          {data.members.map((m) => {
            const self = m.id === myMemberId;
            const wa = isManager && !self ? whatsappLink(m.phone, `Namaste ${m.fullName} 🙏 — ${group.name}`) : null;
            return (
              <li key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={m.fullName} src={m.hasPhoto ? `/groups/${group.id}/members/${m.id}/photo` : null} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                      {m.rotationOrder != null && <span className="rounded bg-stone-100 px-1.5 text-xs text-stone-600">#{num(m.rotationOrder)}</span>}
                      <span className="truncate">{m.fullName}</span>
                      {self && <span className="text-xs font-normal text-stone-400">(you / तपाईं)</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <Badge tone="blue" label={t(m.role)} />
                      <Badge status={m.status} />
                      {m.isContributor && m.paymentStatus && m.paymentStatus !== 'NOT_APPLICABLE' && <Badge status={m.paymentStatus} />}
                    </div>
                    <div className="mt-0.5 text-xs text-stone-500">
                      {t('startDate')}: {date(m.joinedAt)}
                      {m.phone && ` · ${m.phone}`}
                      {m.paymentMethod && ` · ${t(m.paymentMethod)}${m.paymentIdentifier ? ` ${m.paymentIdentifier}` : ''}`}
                      {m.netPosition !== undefined && m.isContributor && ` · ${t('netPosition')}: ${npr(m.netPosition, group.currency)}`}
                      {!!m.arrears && <span className="text-red-600"> · {t('arrears')}: {npr(m.arrears, group.currency)}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 sm:justify-end">
                  {wa && <a className="btn-secondary btn-sm" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
                  {(isManager || self) && m.status !== 'EXITED' && <button className="btn-secondary btn-sm" onClick={() => setEditing(m)}>{t('editMember')}</button>}
                  {isManager && m.role !== 'ORGANIZER' && m.status !== 'EXITED' && m.isContributor && <button className="btn-secondary btn-sm" onClick={() => setStatusFor(m)}>{t('changeStatus')}</button>}
                  {isManager && group.status === 'ACTIVE' && m.role !== 'ORGANIZER' && m.isContributor && m.status !== 'EXITED' && <button className="btn-secondary btn-sm" onClick={() => setExitFor(m)}>{t('earlyExit')}</button>}
                  {!isManager && self && group.status === 'ACTIVE' && myRole === 'MEMBER' && <button className="btn-secondary btn-sm" onClick={() => setExitFor(m)}>{t('earlyExit')}</button>}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <AddMemberModal open={adding} onClose={() => setAdding(false)} onDone={reload} groupId={group.id} draft={draft} />
      {editing && <EditMemberModal member={editing} onClose={() => setEditing(null)} onDone={reload} groupId={group.id} isManager={isManager} draft={draft} myMemberId={myMemberId} />}
      {statusFor && <StatusModal member={statusFor} onClose={() => setStatusFor(null)} onDone={reload} groupId={group.id} />}
      {exitFor && <ExitModal member={exitFor} onClose={() => setExitFor(null)} onDone={reload} groupId={group.id} currency={group.currency} isManager={isManager} />}
    </div>
  );
}

function AddMemberModal({ open, onClose, onDone, groupId, draft }: { open: boolean; onClose: () => void; onDone: () => void; groupId: string; draft: boolean }) {
  const { t } = useI18n();
  const [v, setV] = useState<Details>(emptyDetails);
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api.post(`/groups/${groupId}/members`, detailsPayload(v, { role: true, rotation: true }));
      setV(emptyDetails());
      onDone();
      onClose();
    });
  };
  return (
    <Modal open={open} onClose={onClose} title={t('addMember')}>
      <form onSubmit={submit} className="space-y-3">
        {!draft && <Alert>After the start only viewers can be added. / सुरु भएपछि दर्शक मात्र थप्न सकिन्छ।</Alert>}
        <DetailsFields v={v} set={(k, x) => setV((p) => ({ ...p, [k]: x }))} showRole showRotation={draft} />
        <p className="text-xs text-stone-500">{t('inviteOnlyDescription')}</p>
        <ErrorText error={error} />
        <button className="btn-primary w-full" disabled={busy}>{t('addMember')}</button>
      </form>
    </Modal>
  );
}

function EditMemberModal({ member, onClose, onDone, groupId, isManager, draft, myMemberId }: { member: Member; onClose: () => void; onDone: () => void; groupId: string; isManager: boolean; draft: boolean; myMemberId: string }) {
  const { t } = useI18n();
  const [v, setV] = useState<Details>({
    fullName: member.fullName, phone: member.phone ?? '', email: member.email ?? '', paymentMethod: member.paymentMethod ?? '',
    paymentIdentifier: member.paymentIdentifier ?? '', bankName: member.bankName ?? '', role: member.role, rotationOrder: member.rotationOrder ? String(member.rotationOrder) : '',
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const { busy, error, run } = useAction();
  const canRole = isManager && member.role !== 'ORGANIZER';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api.patch(`/groups/${groupId}/members/${member.id}`, detailsPayload(v, { role: canRole && v.role !== member.role, rotation: isManager && draft && member.isContributor }));
      if (photo) await api.form(`/groups/${groupId}/members/${member.id}/photo`, {}, photo, 'photo');
      onDone();
      onClose();
    });
  };
  const remove = () => {
    const reason = prompt(t('reason'));
    if (!reason || reason.trim().length < 3) return;
    run(async () => { await api.del(`/groups/${groupId}/members/${member.id}`, { reason }); onDone(); onClose(); });
  };
  return (
    <Modal open onClose={onClose} title={member.fullName}>
      <form onSubmit={submit} className="space-y-3">
        <DetailsFields v={v} set={(k, x) => setV((p) => ({ ...p, [k]: x }))} showRole={canRole} showRotation={isManager && draft && member.isContributor} />
        {(isManager || member.id === myMemberId) && (
          <Field label="Photo / फोटो (optional)">
            <input className="input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </Field>
        )}
        <ErrorText error={error} />
        <div className="flex gap-2">
          <button className="btn-primary flex-1" disabled={busy}>{t('save')}</button>
          {isManager && member.role !== 'ORGANIZER' && (draft || !member.isContributor) && <button type="button" className="btn-danger" disabled={busy} onClick={remove}>{t('removeMember')}</button>}
        </div>
      </form>
    </Modal>
  );
}

function StatusModal({ member, onClose, onDone, groupId }: { member: Member; onClose: () => void; onDone: () => void; groupId: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState('SUSPENDED');
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal open onClose={onClose} title={`${t('changeStatus')} · ${member.fullName}`}>
      <div className="space-y-3">
        <p className="text-sm">{t('status')}: <Badge status={member.status} /></p>
        <Field label={t('status')}>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ACTIVE">{t('ACTIVE')} / restore</option>
            <option value="SUSPENDED">{t('SUSPENDED')}</option>
            <option value="DEFAULTED">{t('DEFAULTED')}</option>
          </select>
        </Field>
        <Field label={t('reason')}><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <ErrorText error={error} />
        <button className="btn-primary w-full" disabled={busy || reason.trim().length < 3}
          onClick={() => run(async () => { await api.post(`/groups/${groupId}/members/${member.id}/status`, { status, reason }); onDone(); onClose(); })}>
          {t('confirm')}
        </button>
      </div>
    </Modal>
  );
}

interface ExitQuote {
  remainingContributions: number; penalty: number; amountOwedByMember: number; amountOwedToMember: number; requiredAction: string; explanation: string;
  upcomingRounds: number; member: { hasReceivedPot: boolean };
}

function ExitModal({ member, onClose, onDone, groupId, currency, isManager }: { member: Member; onClose: () => void; onDone: () => void; groupId: string; currency: string; isManager: boolean }) {
  const { t } = useI18n();
  const { data: q } = useApi<ExitQuote>(`/groups/${groupId}/members/${member.id}/exit-quote`);
  const [settlement, setSettlement] = useState<'PAY_REMAINING' | 'REPLACEMENT' | 'REFUND_AT_CYCLE_END'>('REPLACEMENT');
  const [reason, setReason] = useState('');
  const [rep, setRep] = useState<Details>(emptyDetails);
  const { busy, error, run } = useAction();
  const submit = () => run(async () => {
    await api.post(`/groups/${groupId}/members/${member.id}/exit`, {
      settlement, reason, ...(settlement === 'REPLACEMENT' ? { replacement: detailsPayload(rep, { role: false, rotation: false }) } : {}),
    });
    onDone();
    onClose();
  });
  return (
    <Modal open onClose={onClose} title={`${t('earlyExit')} · ${member.fullName}`} wide>
      {!q ? <Spinner /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-stone-100 p-3"><div className="text-xs text-stone-500">{t('remainingContributions')}</div><b>{npr(q.remainingContributions, currency)}</b></div>
            <div className="rounded-xl bg-stone-100 p-3"><div className="text-xs text-stone-500">{t('exitPenalty')}</div><b>{npr(q.penalty, currency)}</b></div>
            <div className="rounded-xl bg-red-50 p-3"><div className="text-xs text-red-700">Member owes group / सदस्यले तिर्नुपर्ने</div><b className="text-red-700">{npr(q.amountOwedByMember, currency)}</b></div>
            <div className="rounded-xl bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Group owes member / समूहले दिनुपर्ने</div><b className="text-emerald-700">{npr(q.amountOwedToMember, currency)}</b></div>
          </div>
          <Alert tone="blue">{q.explanation}</Alert>
          {isManager ? (
            <>
              <Field label="Settlement / फर्छ्यौट">
                <select className="input" value={settlement} onChange={(e) => setSettlement(e.target.value as typeof settlement)}>
                  <option value="REPLACEMENT">Approved replacement takes over the seat / अनुमोदित सदस्यले ठाउँ लिने</option>
                  <option value="PAY_REMAINING">Member pays the outstanding amount / बाँकी रकम तिर्ने</option>
                  {!q.member.hasReceivedPot && <option value="REFUND_AT_CYCLE_END">Refund at cycle end / चक्रको अन्त्यमा फिर्ता</option>}
                </select>
              </Field>
              {settlement === 'REPLACEMENT' && (
                <div className="rounded-xl border border-stone-200 p-3">
                  <div className="mb-2 text-sm font-semibold">Replacement member / नयाँ सदस्य</div>
                  <DetailsFields v={rep} set={(k, x) => setRep((p) => ({ ...p, [k]: x }))} showRole={false} showRotation={false} />
                </div>
              )}
              <Field label={t('reason')}><textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <ErrorText error={error} />
              <button className="btn-danger w-full" disabled={busy || reason.trim().length < 3 || (settlement === 'REPLACEMENT' && rep.fullName.trim().length < 2)} onClick={submit}>{t('confirm')}</button>
            </>
          ) : <p className="text-sm text-stone-600">Ask your organizer to process the exit. / बाहिरिन आयोजकलाई अनुरोध गर्नुहोस्।</p>}
        </div>
      )}
    </Modal>
  );
}
