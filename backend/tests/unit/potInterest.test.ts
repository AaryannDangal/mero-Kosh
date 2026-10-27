import { describe, expect, it } from 'vitest';
import { calculatePotRecipientObligation } from '../../src/domain/calculations';

describe('calculatePotRecipientObligation', () => {
  it('calculates regular contribution when no pot has been taken or pot is fully returned', () => {
    const res = calculatePotRecipientObligation({
      baseContribution: 2000_00, // NPR 2,000
      initialPotAmount: 20000_00, // NPR 20,000
      cumulativePrincipalRepaid: 20000_00,
      cumulativeAdvanceRepayments: 0,
      potInterestRateBp: 100, // 1%
      remainingRounds: 5,
    });

    expect(res.remainingPotPrincipal).toBe(0);
    expect(res.monthlyInterest).toBe(0);
    expect(res.totalMonthlyDue).toBe(2000_00);
  });

  it('calculates pot recipient obligation with interest on initial remaining balance', () => {
    const res = calculatePotRecipientObligation({
      baseContribution: 2000_00, // NPR 2,000
      initialPotAmount: 20000_00, // NPR 20,000
      cumulativePrincipalRepaid: 0,
      cumulativeAdvanceRepayments: 0,
      potInterestRateBp: 100, // 1% per month
      remainingRounds: 10,
    });

    // remaining principal = 20,000 NPR
    expect(res.remainingPotPrincipal).toBe(20000_00);
    // 1% of 20,000 = 200 NPR (200_00 paisa)
    expect(res.monthlyInterest).toBe(200_00);
    // 20,000 / 10 = 2,000 NPR installment
    expect(res.principalInstallment).toBe(2000_00);
    // Total monthly due = 2,000 (base) + 2,000 (installment) + 200 (interest) = 4,200 NPR
    expect(res.totalMonthlyDue).toBe(4200_00);
  });

  it('lowers monthly interest dynamically after advance principal repayment', () => {
    // Suppose pot recipient makes an advance repayment of NPR 10,000
    const res = calculatePotRecipientObligation({
      baseContribution: 2000_00, // NPR 2,000
      initialPotAmount: 20000_00, // NPR 20,000
      cumulativePrincipalRepaid: 0,
      cumulativeAdvanceRepayments: 10000_00, // NPR 10,000 advance
      potInterestRateBp: 100, // 1% per month
      remainingRounds: 10,
    });

    // remaining principal drops to 10,000 NPR!
    expect(res.remainingPotPrincipal).toBe(10000_00);
    // 1% interest is now calculated ONLY on 10,000 = 100 NPR (100_00 paisa)
    expect(res.monthlyInterest).toBe(100_00);
    // installment = 10,000 / 10 = 1,000 NPR
    expect(res.principalInstallment).toBe(1000_00);
    // Total monthly due = 2,000 + 1,000 + 100 = 3,100 NPR
    expect(res.totalMonthlyDue).toBe(3100_00);
  });

  it('handles 0% interest rate correctly', () => {
    const res = calculatePotRecipientObligation({
      baseContribution: 2000_00,
      initialPotAmount: 20000_00,
      cumulativePrincipalRepaid: 0,
      cumulativeAdvanceRepayments: 5000_00,
      potInterestRateBp: 0, // 0%
      remainingRounds: 5,
    });

    expect(res.remainingPotPrincipal).toBe(15000_00);
    expect(res.monthlyInterest).toBe(0);
    expect(res.totalMonthlyDue).toBe(2000_00 + 3000_00); // 2,000 base + 3,000 principal installment
  });
});
