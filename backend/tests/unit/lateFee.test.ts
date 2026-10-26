import { describe, expect, it } from 'vitest';
import { assessRoundLateFee, calculateLateFee, daysLate, paymentStatus } from '../../src/domain/calculations';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('daysLate', () => {
  it('counts days after due date + grace period', () => {
    expect(daysLate(d('2026-03-10'), d('2026-03-10'), 3)).toBe(0);
    expect(daysLate(d('2026-03-10'), d('2026-03-13'), 3)).toBe(0); // last grace day is on time
    expect(daysLate(d('2026-03-10'), d('2026-03-14'), 3)).toBe(1);
    expect(daysLate(d('2026-03-10'), d('2026-03-20'), 0)).toBe(10);
    expect(daysLate(d('2026-03-10'), d('2026-03-01'), 0)).toBe(0);
  });

  it('ignores time of day (date-only comparison)', () => {
    expect(daysLate(d('2026-03-10'), new Date('2026-03-10T23:59:00Z'), 0)).toBe(0);
    expect(daysLate(d('2026-03-10'), new Date('2026-03-11T00:01:00Z'), 0)).toBe(1);
  });
});

describe('calculateLateFee', () => {
  it('FIXED: flat amount once late', () => {
    expect(calculateLateFee({ type: 'FIXED', value: 50_000 }, 1_000_000, 1)).toBe(50_000);
    expect(calculateLateFee({ type: 'FIXED', value: 50_000 }, 1_000_000, 30)).toBe(50_000);
  });

  it('PERCENTAGE: basis points of the amount outstanding at the deadline (rounded to paisa)', () => {
    expect(calculateLateFee({ type: 'PERCENTAGE', value: 500 }, 1_000_000, 2)).toBe(50_000); // 5%
    expect(calculateLateFee({ type: 'PERCENTAGE', value: 250 }, 333_333, 2)).toBe(8_333); // 2.5% of 3333.33
  });

  it('DAILY: amount × days late', () => {
    expect(calculateLateFee({ type: 'DAILY', value: 10_000 }, 1_000_000, 7)).toBe(70_000);
  });

  it('respects the cap', () => {
    expect(calculateLateFee({ type: 'DAILY', value: 10_000, cap: 50_000 }, 1_000_000, 30)).toBe(50_000);
  });

  it('no fee when on time, nothing outstanding, or NONE', () => {
    expect(calculateLateFee({ type: 'FIXED', value: 50_000 }, 1_000_000, 0)).toBe(0);
    expect(calculateLateFee({ type: 'FIXED', value: 50_000 }, 0, 5)).toBe(0);
    expect(calculateLateFee({ type: 'NONE', value: 50_000 }, 1_000_000, 5)).toBe(0);
  });
});

describe('assessRoundLateFee (from actual payment history)', () => {
  const base = { amountDue: 1_000_000, dueDate: d('2026-03-10'), gracePeriodDays: 2 };

  it('paid on time → no fee', () => {
    const r = assessRoundLateFee({ ...base, payments: [{ amount: 1_000_000, paidAt: d('2026-03-12') }], asOf: d('2026-04-01'), rule: { type: 'DAILY', value: 10_000 } });
    expect(r).toMatchObject({ lateFee: 0, daysLate: 0, outstanding: 0 });
  });

  it('paid late → daily fee counts until the day it was fully paid', () => {
    const r = assessRoundLateFee({ ...base, payments: [{ amount: 1_000_000, paidAt: d('2026-03-17') }], asOf: d('2026-04-01'), rule: { type: 'DAILY', value: 10_000 } });
    expect(r.daysLate).toBe(5);
    expect(r.lateFee).toBe(50_000);
    expect(r.settledAt?.toISOString().slice(0, 10)).toBe('2026-03-17');
  });

  it('partial by deadline → percentage applies to the remaining amount', () => {
    const r = assessRoundLateFee({
      ...base,
      payments: [{ amount: 600_000, paidAt: d('2026-03-09') }, { amount: 400_000, paidAt: d('2026-03-20') }],
      asOf: d('2026-04-01'),
      rule: { type: 'PERCENTAGE', value: 1000 },
    });
    expect(r.outstandingAtDeadline).toBe(400_000);
    expect(r.lateFee).toBe(40_000);
  });

  it('still unpaid → fee grows until as-of date', () => {
    const r = assessRoundLateFee({ ...base, payments: [], asOf: d('2026-03-22'), rule: { type: 'DAILY', value: 10_000 } });
    expect(r.daysLate).toBe(10);
    expect(r.lateFee).toBe(100_000);
    expect(r.outstanding).toBe(1_000_000);
  });

  it('a fully discounted obligation is never late', () => {
    const r = assessRoundLateFee({ ...base, amountDue: 0, payments: [], asOf: d('2026-05-01'), rule: { type: 'FIXED', value: 50_000 } });
    expect(r.lateFee).toBe(0);
  });
});

describe('paymentStatus', () => {
  const due = d('2026-03-10');
  it('paid / partial / unpaid / overdue', () => {
    expect(paymentStatus({ amountDue: 100, paid: 100, dueDate: due, gracePeriodDays: 2, asOf: d('2026-04-01') })).toBe('PAID');
    expect(paymentStatus({ amountDue: 100, paid: 50, dueDate: due, gracePeriodDays: 2, asOf: d('2026-03-11') })).toBe('PARTIAL');
    expect(paymentStatus({ amountDue: 100, paid: 0, dueDate: due, gracePeriodDays: 2, asOf: d('2026-03-12') })).toBe('UNPAID');
    expect(paymentStatus({ amountDue: 100, paid: 50, dueDate: due, gracePeriodDays: 2, asOf: d('2026-03-13') })).toBe('OVERDUE');
  });
});
