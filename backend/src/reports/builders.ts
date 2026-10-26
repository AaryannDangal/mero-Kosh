import { reconcileRound } from '../domain/calculations';
import { notFound } from '../lib/errors';
import type { GroupState } from '../services/state';
import { effectiveType, roundCashFlows } from '../services/state';
import type { Column, ReportTable } from './render';

const nowIso = () => new Date().toISOString();
const nameOf = (s: GroupState, id: string | null | undefined) => (id ? s.members.find((m) => m.id === id)?.fullName ?? '—' : '—');

// ---------------------------------------------------------------------------
export function roundReport(s: GroupState, roundId: string): ReportTable {
  const r = s.rounds.find((x) => x.id === roundId);
  if (!r) throw notFound('Round');
  const flows = roundCashFlows(s.entries, r.id);
  const rec = reconcileRound({
    openingBalance: r.openingBalance,
    totalContributions: flows.contributions,
    lateFees: flows.lateFees + flows.penalties,
    payoutToWinner: flows.payouts,
    otherAdjustments: flows.adjustments - flows.refunds,
    actualClosingBalance: r.actualClosingBalance,
  });
  const columns: Column[] = [
    { key: 'member', en: 'Member', ne: 'सदस्य' },
    { key: 'contributionDue', en: 'Contribution', ne: 'योगदान', kind: 'money' },
    { key: 'discountCredit', en: 'Discount credit', ne: 'छुट मिलान', kind: 'money' },
    { key: 'amountDue', en: 'Amount due', ne: 'तिर्नुपर्ने', kind: 'money' },
    { key: 'paid', en: 'Paid (verified)', ne: 'तिरेको (प्रमाणित)', kind: 'money' },
    { key: 'pending', en: 'Pending', ne: 'विचाराधीन', kind: 'money' },
    { key: 'outstanding', en: 'Outstanding', ne: 'बाँकी', kind: 'money' },
    { key: 'status', en: 'Status', ne: 'स्थिति' },
    { key: 'daysLate', en: 'Days late', ne: 'ढिलो दिन', kind: 'number' },
    { key: 'lateFee', en: 'Late fee', ne: 'ढिलो शुल्क', kind: 'money' },
  ];
  const rows = r.obligations.map((o) => {
    const rs = s.balances.get(o.memberId)?.rounds.find((x) => x.roundId === r.id);
    return {
      member: nameOf(s, o.memberId) + (o.memberId === r.winnerMemberId ? ' (recipient / प्राप्तकर्ता)' : ''),
      contributionDue: o.contributionDue,
      discountCredit: o.discountCredit,
      amountDue: rs?.amountDue ?? 0,
      paid: rs?.paid ?? 0,
      pending: rs?.pending ?? 0,
      outstanding: rs?.outstanding ?? 0,
      status: rs?.status ?? '',
      daysLate: rs?.daysLate ?? 0,
      lateFee: rs?.lateFeeAssessed ?? 0,
    };
  });
  return {
    id: `round-${r.roundNumber}-report`,
    title: { en: `Round ${r.roundNumber} report — ${s.group.name}`, ne: `चरण ${r.roundNumber} प्रतिवेदन — ${s.group.name}` },
    subtitle: `${r.periodLabel} • due ${r.dueDate.toISOString().slice(0, 10)} • status ${r.status}`,
    currency: s.group.currency,
    columns,
    rows,
    summary: [
      { en: 'Full pot', ne: 'पूरा ढुकुटी', value: r.fullPot, kind: 'money' },
      { en: 'Pot recipient', ne: 'ढुकुटी प्राप्तकर्ता', value: nameOf(s, r.winnerMemberId) },
      { en: 'Selection method', ne: 'छनोट विधि', value: r.selectionMethod + (r.selectionOverrideReason ? ` (override: ${r.selectionOverrideReason})` : '') },
      { en: 'Bid discount', ne: 'बोल छुट', value: r.bidDiscount, kind: 'money' },
      { en: 'Payout to winner', ne: 'विजेतालाई भुक्तानी', value: r.payoutToWinner, kind: 'money' },
      { en: 'Discount share per member', ne: 'प्रति सदस्य छुट हिस्सा', value: r.discountSharePerMember, kind: 'money' },
      { en: 'Expected collection', ne: 'अपेक्षित संकलन', value: r.expectedCollection, kind: 'money' },
      { en: 'Actual collection (cash book)', ne: 'वास्तविक संकलन', value: flows.contributions, kind: 'money' },
      { en: 'Late fees & penalties', ne: 'ढिलो शुल्क र जरिवाना', value: flows.lateFees + flows.penalties, kind: 'money' },
      { en: 'Opening balance', ne: 'सुरु मौज्दात', value: r.openingBalance, kind: 'money' },
      { en: 'Calculated closing balance', ne: 'गणना गरिएको अन्तिम मौज्दात', value: rec.calculatedClosingBalance, kind: 'money' },
      { en: 'Actual closing balance', ne: 'वास्तविक अन्तिम मौज्दात', value: r.actualClosingBalance, kind: 'money' },
      { en: 'Reconciliation', ne: 'हिसाब मिलान', value: r.status === 'COMPLETED' ? r.reconciliationStatus : rec.status },
    ],
    warnings: [rec.warning, r.reconciliationNote ? `Mismatch acknowledged: ${r.reconciliationNote}` : null].filter((x): x is string => !!x),
    generatedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
export function cycleReport(s: GroupState): ReportTable {
  const columns: Column[] = [
    { key: 'round', en: 'Round', ne: 'चरण', kind: 'number' },
    { key: 'period', en: 'Period', ne: 'अवधि' },
    { key: 'dueDate', en: 'Due date', ne: 'भुक्तानी मिति', kind: 'date' },
    { key: 'fullPot', en: 'Full pot', ne: 'पूरा ढुकुटी', kind: 'money' },
    { key: 'winner', en: 'Recipient', ne: 'प्राप्तकर्ता' },
    { key: 'bidDiscount', en: 'Bid discount', ne: 'बोल छुट', kind: 'money' },
    { key: 'payout', en: 'Payout', ne: 'भुक्तानी', kind: 'money' },
    { key: 'expected', en: 'Expected', ne: 'अपेक्षित', kind: 'money' },
    { key: 'collected', en: 'Collected', ne: 'संकलित', kind: 'money' },
    { key: 'lateFees', en: 'Late fees', ne: 'ढिलो शुल्क', kind: 'money' },
    { key: 'opening', en: 'Opening', ne: 'सुरु मौज्दात', kind: 'money' },
    { key: 'closing', en: 'Closing', ne: 'अन्तिम मौज्दात', kind: 'money' },
    { key: 'reconciliation', en: 'Reconciliation', ne: 'मिलान' },
    { key: 'status', en: 'Status', ne: 'स्थिति' },
  ];
  const rows = s.rounds.map((r) => {
    const f = roundCashFlows(s.entries, r.id);
    return {
      round: r.roundNumber,
      period: r.periodLabel,
      dueDate: r.dueDate.toISOString(),
      fullPot: r.fullPot,
      winner: nameOf(s, r.winnerMemberId),
      bidDiscount: r.bidDiscount,
      payout: r.payoutToWinner,
      expected: r.expectedCollection,
      collected: r.status === 'UPCOMING' ? null : f.contributions,
      lateFees: r.status === 'UPCOMING' ? null : f.lateFees + f.penalties,
      opening: r.status === 'UPCOMING' ? null : r.openingBalance,
      closing: r.calculatedClosingBalance,
      reconciliation: r.reconciliationStatus,
      status: r.status,
    };
  });
  const v = s.cycleValidation;
  return {
    id: 'full-cycle-report',
    title: { en: `Full cycle report — ${s.group.name}`, ne: `पूर्ण चक्र प्रतिवेदन — ${s.group.name}` },
    subtitle: `Status ${s.group.status} • ${s.group.memberCount} members • ${s.group.selectionMethod}`,
    currency: s.group.currency,
    columns,
    rows,
    summary: [
      { en: 'Fund balance (sum of net positions)', ne: 'कोष मौज्दात (खुद स्थितिको योग)', value: s.fundBalance, kind: 'money' },
      { en: 'Zero-sum check', ne: 'शून्य-योग जाँच', value: v.isZero ? 'OK' : 'NOT ZERO' },
    ],
    warnings: !v.isZero && s.group.status !== 'ACTIVE' ? [v.error!] : [],
    generatedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
export function memberStatement(s: GroupState, memberId: string): ReportTable {
  const b = s.balances.get(memberId);
  if (!b) throw notFound('Member');
  const columns: Column[] = [
    { key: 'txn', en: 'Txn #', ne: 'कारोबार नं.', kind: 'number' },
    { key: 'date', en: 'Date', ne: 'मिति', kind: 'date' },
    { key: 'round', en: 'Round', ne: 'चरण', kind: 'number' },
    { key: 'type', en: 'Type', ne: 'प्रकार' },
    { key: 'method', en: 'Method', ne: 'माध्यम' },
    { key: 'reference', en: 'Reference', ne: 'सन्दर्भ नं.' },
    { key: 'credit', en: 'Paid in', ne: 'जम्मा', kind: 'money' },
    { key: 'debit', en: 'Received', ne: 'प्राप्त', kind: 'money' },
    { key: 'nonCash', en: 'Discount credit', ne: 'छुट मिलान', kind: 'money' },
    { key: 'balance', en: 'Net position', ne: 'खुद स्थिति', kind: 'money' },
    { key: 'status', en: 'Status', ne: 'स्थिति' },
  ];
  let running = 0;
  const roundNo = (id: string | null) => s.rounds.find((r) => r.id === id)?.roundNumber ?? null;
  const rows = s.entries
    .filter((e) => e.memberId === memberId)
    .sort((a, b2) => a.paidAt.getTime() - b2.paidAt.getTime() || a.seq - b2.seq)
    .map((e) => {
      const t = effectiveType(e);
      const inflow = ['CONTRIBUTION', 'LATE_FEE', 'PENALTY', 'MANUAL_ADJUSTMENT'].includes(t);
      const outflow = ['POT_PAYOUT', 'REFUND'].includes(t);
      let credit: number | null = null;
      let debit: number | null = null;
      let nonCash: number | null = null;
      if (t === 'BID_DISCOUNT') nonCash = e.amount;
      else if (inflow) credit = e.amount;
      else if (outflow) debit = e.amount;
      if (e.status === 'VERIFIED') running += (credit ?? 0) - (debit ?? 0);
      return {
        txn: e.seq,
        date: e.paidAt.toISOString(),
        round: roundNo(e.roundId),
        type: e.type === 'CORRECTION' ? `CORRECTION of ${t}` : e.type,
        method: e.method,
        reference: e.referenceNumber,
        credit,
        debit,
        nonCash,
        balance: running,
        status: e.status,
      };
    });
  const t = b.totals;
  return {
    id: `member-statement-${b.fullName.replace(/\s+/g, '-').toLowerCase()}`,
    title: { en: `Member statement — ${b.fullName}`, ne: `सदस्य विवरण — ${b.fullName}` },
    subtitle: `${s.group.name} • status ${b.status} • pot ${b.potStatus}`,
    currency: s.group.currency,
    columns,
    rows,
    summary: [
      { en: 'Total contributions paid', ne: 'जम्मा योगदान', value: t.contributions, kind: 'money' },
      { en: 'Total bid discounts received', ne: 'जम्मा छुट प्राप्त', value: b.totalDiscountCredits, kind: 'money' },
      { en: 'Total late fees paid', ne: 'जम्मा ढिलो शुल्क', value: t.lateFeesPaid, kind: 'money' },
      { en: 'Total pot received', ne: 'जम्मा ढुकुटी प्राप्त', value: t.potReceived, kind: 'money' },
      { en: 'Refunds received', ne: 'फिर्ता प्राप्त', value: t.refundsReceived, kind: 'money' },
      { en: 'Net position', ne: 'खुद स्थिति', value: t.netPosition, kind: 'money' },
      { en: 'Arrears', ne: 'बक्यौता', value: b.arrears, kind: 'money' },
      { en: 'Late fee outstanding', ne: 'बाँकी ढिलो शुल्क', value: b.lateFeeOutstanding, kind: 'money' },
      { en: 'Remaining contributions', ne: 'बाँकी योगदान', value: b.remainingContributions, kind: 'money' },
    ],
    generatedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
export function arrearsReport(s: GroupState, includeContact: boolean): ReportTable {
  const columns: Column[] = [
    { key: 'member', en: 'Member', ne: 'सदस्य' },
    ...(includeContact ? [{ key: 'phone', en: 'Phone', ne: 'फोन' } as Column] : []),
    { key: 'status', en: 'Member status', ne: 'सदस्य स्थिति' },
    { key: 'rounds', en: 'Rounds unpaid', ne: 'नतिरेका चरण' },
    { key: 'arrears', en: 'Arrears', ne: 'बक्यौता', kind: 'money' },
    { key: 'overdue', en: 'Overdue (after grace)', ne: 'म्याद नाघेको', kind: 'money' },
    { key: 'lateFee', en: 'Late fee outstanding', ne: 'बाँकी ढिलो शुल्क', kind: 'money' },
    { key: 'total', en: 'Total owed', ne: 'जम्मा तिर्नुपर्ने', kind: 'money' },
  ];
  const rows = [...s.balances.values()]
    .filter((b) => b.arrears > 0 || b.lateFeeOutstanding > 0)
    .map((b) => ({
      member: b.fullName,
      phone: s.members.find((m) => m.id === b.memberId)?.phone ?? '',
      status: b.status,
      rounds: b.rounds.filter((r) => r.outstanding > 0 && r.dueDate < s.asOf).map((r) => r.roundNumber).join(', '),
      arrears: b.arrears,
      overdue: b.overdueAmount,
      lateFee: b.lateFeeOutstanding,
      total: b.arrears + b.lateFeeOutstanding,
    }))
    .sort((a, b) => b.total - a.total);
  return {
    id: 'outstanding-arrears-report',
    title: { en: `Outstanding arrears — ${s.group.name}`, ne: `बाँकी बक्यौता — ${s.group.name}` },
    currency: s.group.currency,
    columns,
    rows,
    summary: [
      { en: 'Total arrears', ne: 'जम्मा बक्यौता', value: rows.reduce((a, r) => a + r.arrears, 0), kind: 'money' },
      { en: 'Total late fees outstanding', ne: 'जम्मा बाँकी ढिलो शुल्क', value: rows.reduce((a, r) => a + r.lateFee, 0), kind: 'money' },
    ],
    generatedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
export function latePaymentReport(s: GroupState): ReportTable {
  const columns: Column[] = [
    { key: 'member', en: 'Member', ne: 'सदस्य' },
    { key: 'round', en: 'Round', ne: 'चरण', kind: 'number' },
    { key: 'dueDate', en: 'Due date', ne: 'भुक्तानी मिति', kind: 'date' },
    { key: 'settledAt', en: 'Paid in full on', ne: 'पूरा तिरेको मिति', kind: 'date' },
    { key: 'daysLate', en: 'Days late', ne: 'ढिलो दिन', kind: 'number' },
    { key: 'feeAssessed', en: 'Late fee', ne: 'ढिलो शुल्क', kind: 'money' },
    { key: 'feePaid', en: 'Fee paid', ne: 'तिरेको शुल्क', kind: 'money' },
    { key: 'feeOutstanding', en: 'Fee outstanding', ne: 'बाँकी शुल्क', kind: 'money' },
    { key: 'status', en: 'Payment status', ne: 'भुक्तानी स्थिति' },
  ];
  const rows = [...s.balances.values()].flatMap((b) =>
    b.rounds
      .filter((r) => r.daysLate > 0)
      .map((r) => ({
        member: b.fullName,
        round: r.roundNumber,
        dueDate: r.dueDate.toISOString(),
        settledAt: r.settledAt ? r.settledAt.toISOString() : null,
        daysLate: r.daysLate,
        feeAssessed: r.lateFeeAssessed,
        feePaid: r.lateFeePaid,
        feeOutstanding: r.lateFeeOutstanding,
        status: r.status,
      })),
  ).sort((a, b) => a.round - b.round || a.member.localeCompare(b.member));
  return {
    id: 'late-payment-report',
    title: { en: `Late payments — ${s.group.name}`, ne: `ढिलो भुक्तानी — ${s.group.name}` },
    subtitle: `Late fee rule: ${s.group.lateFeeType} • grace ${s.group.gracePeriodDays} days`,
    currency: s.group.currency,
    columns,
    rows,
    summary: [
      { en: 'Late fees assessed', ne: 'लगाइएको ढिलो शुल्क', value: rows.reduce((a, r) => a + r.feeAssessed, 0), kind: 'money' },
      { en: 'Late fees paid', ne: 'तिरिएको ढिलो शुल्क', value: rows.reduce((a, r) => a + r.feePaid, 0), kind: 'money' },
    ],
    generatedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
export function reconciliationReport(s: GroupState): ReportTable {
  const columns: Column[] = [
    { key: 'round', en: 'Round', ne: 'चरण' },
    { key: 'opening', en: 'Opening', ne: 'सुरु मौज्दात', kind: 'money' },
    { key: 'contributions', en: 'Contributions', ne: 'योगदान', kind: 'money' },
    { key: 'lateFees', en: 'Late fees', ne: 'ढिलो शुल्क', kind: 'money' },
    { key: 'payout', en: 'Payout', ne: 'भुक्तानी', kind: 'money' },
    { key: 'other', en: 'Refunds/adjust.', ne: 'फिर्ता/समायोजन', kind: 'money' },
    { key: 'calculated', en: 'Calculated closing', ne: 'गणना अन्तिम', kind: 'money' },
    { key: 'actual', en: 'Actual closing', ne: 'वास्तविक अन्तिम', kind: 'money' },
    { key: 'difference', en: 'Difference', ne: 'फरक', kind: 'money' },
    { key: 'cash', en: 'Cash in/out', ne: 'नगद', },
    { key: 'bank', en: 'Bank in/out', ne: 'बैंक' },
    { key: 'wallet', en: 'eSewa/Khalti in/out', ne: 'इसेवा/खल्ती' },
    { key: 'status', en: 'Status', ne: 'स्थिति' },
  ];
  const fmt = (x?: { in: number; out: number }) => (x ? `${(x.in / 100).toFixed(2)} / ${(x.out / 100).toFixed(2)}` : '0.00 / 0.00');
  const sumWallet = (m: Record<string, { in: number; out: number }>) => {
    const a = m.ESEWA ?? { in: 0, out: 0 };
    const b = m.KHALTI ?? { in: 0, out: 0 };
    return { in: a.in + b.in, out: a.out + b.out };
  };
  const warnings: string[] = [];
  const rowFor = (label: string, roundId: string | null, opening: number, actual: number | null, status: string) => {
    const f = roundCashFlows(s.entries, roundId);
    const rec = reconcileRound({
      openingBalance: opening,
      totalContributions: f.contributions,
      lateFees: f.lateFees + f.penalties,
      payoutToWinner: f.payouts,
      otherAdjustments: f.adjustments - f.refunds,
      actualClosingBalance: actual,
    });
    if (rec.warning) warnings.push(`${label}: ${rec.warning}`);
    return {
      round: label,
      opening,
      contributions: f.contributions,
      lateFees: f.lateFees + f.penalties,
      payout: f.payouts,
      other: f.adjustments - f.refunds,
      calculated: rec.calculatedClosingBalance,
      actual,
      difference: rec.difference,
      cash: fmt(f.byMethod.CASH),
      bank: fmt(f.byMethod.BANK_TRANSFER),
      wallet: fmt(sumWallet(f.byMethod)),
      status,
    };
  };
  const rows = s.rounds.filter((r) => r.status !== 'UPCOMING').map((r) =>
    rowFor(`Round ${r.roundNumber}`, r.id, r.openingBalance, r.actualClosingBalance, r.status === 'COMPLETED' ? r.reconciliationStatus : 'OPEN'),
  );
  const lastClosed = [...s.rounds].reverse().find((r) => r.status === 'COMPLETED');
  if (s.entries.some((e) => e.status === 'VERIFIED' && e.ledgerRoundId === null)) {
    rows.push(rowFor('Settlement', null, lastClosed?.calculatedClosingBalance ?? 0, null, 'SETTLEMENT'));
  }
  return {
    id: 'cash-bank-reconciliation-report',
    title: { en: `Cash / bank reconciliation — ${s.group.name}`, ne: `नगद / बैंक हिसाब मिलान — ${s.group.name}` },
    subtitle: 'opening + contributions + late fees − payout (± refunds/adjustments) = closing. Method columns in NPR (in / out).',
    currency: s.group.currency,
    columns,
    rows,
    summary: [
      { en: 'Fund balance (ledger)', ne: 'कोष मौज्दात', value: s.fundBalance, kind: 'money' },
      { en: 'Zero-sum check', ne: 'शून्य-योग जाँच', value: s.cycleValidation.isZero ? 'OK' : `${s.cycleValidation.sumOfNetPositions / 100} NPR` },
    ],
    warnings,
    generatedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
export function chartData(s: GroupState) {
  return {
    collectionRate: s.rounds.filter((r) => r.status !== 'UPCOMING').map((r) => {
      const f = roundCashFlows(s.entries, r.id);
      const paidForRound = r.obligations.reduce((a, o) => a + (s.balances.get(o.memberId)?.rounds.find((x) => x.roundId === r.id)?.paid ?? 0), 0);
      const expected = r.expectedCollection ?? 0;
      return { round: r.roundNumber, expected, collected: paidForRound, cashBook: f.contributions, rate: expected ? Math.round((paidForRound / expected) * 1000) / 10 : 0 };
    }),
    arrears: [...s.balances.values()].filter((b) => b.isContributor).map((b) => ({ memberId: b.memberId, name: b.fullName, arrears: b.arrears, lateFeeOutstanding: b.lateFeeOutstanding })),
    payoutSchedule: s.rounds.map((r) => ({
      round: r.roundNumber,
      dueDate: r.dueDate.toISOString().slice(0, 10),
      recipient: r.winnerMemberId ? nameOf(s, r.winnerMemberId) : s.group.selectionMethod === 'FIXED_ROTATION' ? s.members.find((m) => m.rotationOrder === r.roundNumber)?.fullName ?? null : null,
      payout: r.payoutToWinner ?? (r.status === 'UPCOMING' ? s.group.contributionAmount * s.group.memberCount : null),
      status: r.status,
    })),
    netPositions: [...s.balances.values()].filter((b) => b.isContributor || b.totals.netPosition !== 0).map((b) => ({ memberId: b.memberId, name: b.fullName, net: b.totals.netPosition })),
    fundBalance: s.fundBalance,
    cycleValidation: s.cycleValidation,
  };
}
