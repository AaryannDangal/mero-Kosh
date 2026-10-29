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
    });

    expect(res.remainingPotPrincipal).toBe(0);
    expect(res.monthlyInterest).toBe(0);
    expect(res.totalMonthlyDue).toBe(2000_00);
  });

  it('charges the normal contribution plus interest on the pot', () => {
    const res = calculatePotRecipientObligation({
      baseContribution: 2000_00, // NPR 2,000
      initialPotAmount: 20000_00, // NPR 20,000
      cumulativePrincipalRepaid: 0,
      cumulativeAdvanceRepayments: 0,
      potInterestRateBp: 100, // 1% per month
    });

    // remaining principal = 20,000 NPR
    expect(res.remainingPotPrincipal).toBe(20000_00);
    // 1% of 20,000 = 200 NPR (200_00 paisa)
    expect(res.monthlyInterest).toBe(200_00);
    // the normal contribution is credited against the pot
    expect(res.principalInstallment).toBe(2000_00);
    // Total monthly due = 2,000 (credited to pot) + 200 (interest) = 2,200 NPR
    expect(res.totalMonthlyDue).toBe(2200_00);
  });

  it('keeps the interest on the original pot after an advance principal repayment', () => {
    // Suppose pot recipient makes an advance repayment of NPR 10,000
    const res = calculatePotRecipientObligation({
      baseContribution: 2000_00, // NPR 2,000
      initialPotAmount: 20000_00, // NPR 20,000
      cumulativePrincipalRepaid: 0,
      cumulativeAdvanceRepayments: 10000_00, // NPR 10,000 advance
      potInterestRateBp: 100, // 1% per month
    });

    // remaining principal drops to 10,000 NPR
    expect(res.remainingPotPrincipal).toBe(10000_00);
    // interest stays on the ORIGINAL pot: 1% of 20,000 = 200 NPR, it does not shrink
    expect(res.monthlyInterest).toBe(200_00);
    expect(res.principalInstallment).toBe(2000_00);
    expect(res.totalMonthlyDue).toBe(2200_00);
  });

  it('charges interest on the original pot for a large pot', () => {
    // Pot of NPR 100,000, everyone contributing NPR 2,000.
    const res = calculatePotRecipientObligation({
      baseContribution: 2000_00,
      initialPotAmount: 100000_00,
      cumulativePrincipalRepaid: 0,
      cumulativeAdvanceRepayments: 0,
      potInterestRateBp: 100, // 1% per month
    });

    expect(res.remainingPotPrincipal).toBe(100000_00);
    expect(res.monthlyInterest).toBe(1000_00);
    expect(res.principalInstallment).toBe(2000_00);
    // NPR 2,000 (their share, credited to the pot) + NPR 1,000 interest = NPR 3,000
    expect(res.totalMonthlyDue).toBe(3000_00);
  });

  it('caps the credited contribution at what is still owed', () => {
    const res = calculatePotRecipientObligation({
      baseContribution: 2000_00,
      initialPotAmount: 20000_00,
      cumulativePrincipalRepaid: 19500_00,
      cumulativeAdvanceRepayments: 0,
      potInterestRateBp: 100,
    });

    expect(res.remainingPotPrincipal).toBe(500_00);
    // only NPR 500 of the pot is left, so that is all the contribution can repay
    expect(res.principalInstallment).toBe(500_00);
    expect(res.monthlyInterest).toBe(200_00);
    expect(res.totalMonthlyDue).toBe(700_00);
  });

  it('handles 0% interest rate correctly', () => {
    const res = calculatePotRecipientObligation({
      baseContribution: 2000_00,
      initialPotAmount: 20000_00,
      cumulativePrincipalRepaid: 0,
      cumulativeAdvanceRepayments: 5000_00,
      potInterestRateBp: 0, // 0%
    });

    expect(res.remainingPotPrincipal).toBe(15000_00);
    expect(res.monthlyInterest).toBe(0);
    expect(res.totalMonthlyDue).toBe(2000_00); // the contribution credited to the pot
  });
});
