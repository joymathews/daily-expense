import { describe, it, expect } from 'vitest';
import { getSignedAmount } from './transaction-helper';

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

  it('should default to positive amount if transactionType is undefined or null', () => {
    expect(getSignedAmount({ amount: 20.00 })).toBe(20.00);
    expect(getSignedAmount({ amount: 30.00, transactionType: null })).toBe(30.00);
  });
});
