import { describe, it, expect } from 'vitest';
import { getSignedAmount, computeSalaryAllocation } from './transaction-helper';

describe('getSignedAmount', () => {
  it('should return positive amount for standard expense transaction type', () => {
    expect(getSignedAmount({ amount: 15.50, transactionType: 'expense' })).toBe(15.50);
  });

  it('should return negative amount for refund transaction type', () => {
    expect(getSignedAmount({ amount: 100.00, transactionType: 'refund' })).toBe(-100.00);
  });

  it('should return 0 for transfer transaction type', () => {
    expect(getSignedAmount({ amount: 500.00, transactionType: 'transfer' })).toBe(0);
  });

  it('should return 0 for fixed transaction type to prevent double-counting', () => {
    expect(getSignedAmount({ amount: 1200.00, transactionType: 'fixed' })).toBe(0);
  });

  it('should default to positive amount if transactionType is undefined or null', () => {
    expect(getSignedAmount({ amount: 20.00 })).toBe(20.00);
    expect(getSignedAmount({ amount: 30.00, transactionType: null })).toBe(30.00);
  });
});

describe('computeSalaryAllocation with Fixed Charges templates', () => {
  const billingCycleRange = { start: '2026-06-17', end: '2026-07-17' };
  const expectedSalary = 100000;

  const mockTransactions = [
    { amount: 10000, transactionDate: '2026-06-20', category: 'Investment', transactionType: 'expense' },
    { amount: 2000, transactionDate: '2026-06-21', category: 'Food', transactionType: 'expense' },
    { amount: 15000, transactionDate: '2026-06-25', category: 'Rent', transactionType: 'fixed' } // Excluded from ledger aggregates to prevent duplicate
  ];

  /**
   * [FUNC-ANALYSIS-8] Fixed Charge Type and Allocation Exclusion
   * [FUNC-ANALYSIS-9] Salary Allocation Itemized Fixed Charges
   */
  it('should exclude ledger fixed transactions from direct sums and add templates correctly', () => {
    const fixedCharges = [
      { id: 'fc-1', userId: 'user-1', name: 'House Rent', amount: 15000, currency: 'INR', category: 'Rent', startDate: '2026-06-01', endDate: '2026-12-01' },
      { id: 'fc-2', userId: 'user-1', name: 'SIP Investment', amount: 5000, currency: 'INR', category: 'Investment', startDate: '2026-06-10', endDate: '2026-08-10' },
      // Out of range fixed charge (should be ignored)
      { id: 'fc-3', userId: 'user-1', name: 'Future EMI', amount: 3000, currency: 'INR', category: 'Loans', startDate: '2026-08-01', endDate: '2026-10-01' }
    ];

    const result = computeSalaryAllocation(mockTransactions, billingCycleRange, expectedSalary, fixedCharges);

    // Ledger: Investment (10000). Active Template: SIP Investment (5000) -> MutualFund = 15000 (15%)
    expect(result.mutualFundSpend).toBe(15000);
    expect(result.mutualFundPercent).toBe(15);

    // Ledger: Food (2000). Active Template: House Rent (15000). Fixed ledger transaction is ignored -> Consumption = 17000 (17%)
    expect(result.consumptionSpend).toBe(17000);
    expect(result.consumptionPercent).toBe(17);

    // Unspent: 100000 - 15000 - 17000 = 68000 (68%)
    expect(result.totalSaved).toBe(68000);
    expect(result.unspentPercent).toBe(68);
  });
});
