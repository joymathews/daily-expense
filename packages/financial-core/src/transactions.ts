import { FinancialTransaction, FixedCharge, DailyTrendPoint, SalaryAllocationResult } from './types';
import { getDatesInRange } from './cycles';

export const STANDARD_CATEGORIES = [
  'Groceries',
  'Cabs & Transport',
  'Travel',
  'Utilities',
  'Internet & Telecom',
  'Entertainment Subscriptions',
  'Cloud & Software Services',
  'Shopping',
  'Restaurant & Dining',
  'Online Food Order',
  'Medical & Healthcare',
  'Other',
];

/**
 * Formats ISO timestamp or date-only string into user local time (12-hour AM/PM format)
 */
export const formatLocalTransactionTime = (isoString?: string): string | null => {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return null;
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
    return null;
  }
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
};

/**
 * Normalizes category names into Title Case and standard predefined taxonomy.
 */
export const normalizeCategory = (cat?: string): string => {
  if (!cat || typeof cat !== 'string') return 'Other';
  const trimmed = cat.trim();
  if (!trimmed) return 'Other';

  const lower = trimmed.toLowerCase();
  const standardMap: Record<string, string> = {
    food: 'Food & Dining',
    dining: 'Food & Dining',
    restaurant: 'Food & Dining',
    'online food order': 'Food & Dining',
    'food & dining': 'Food & Dining',
    groceries: 'Groceries',
    grocery: 'Groceries',
    shopping: 'Shopping',
    utilities: 'Utilities',
    utility: 'Utilities',
    bills: 'Utilities',
    medical: 'Medical & Healthcare',
    healthcare: 'Medical & Healthcare',
    health: 'Medical & Healthcare',
    transport: 'Transportation',
    travel: 'Transportation',
    fuel: 'Transportation',
    entertainment: 'Entertainment',
    investments: 'Investments',
    investment: 'Investments',
  };

  if (standardMap[lower]) {
    return standardMap[lower];
  }

  // Title Case custom categories
  return trimmed
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Helper to identify if a transaction's payment method is a credit card or deferred liability card
 * vs direct bank debit (UPI, Cash, Debit Card).
 */
export const isCreditCardPayment = (paymentMethod?: string): boolean => {
  if (!paymentMethod || paymentMethod.trim() === '') return true;
  const pm = paymentMethod.toLowerCase();
  if (pm.includes('debit')) return false;
  if (pm.includes('bank')) return false;
  if (pm.includes('upi')) return false;
  if (pm.includes('cash')) return false;
  if (
    pm.includes('credit') ||
    pm.includes('cc') ||
    pm.includes('rupay') ||
    pm.includes('card') ||
    pm.includes('hdfc') ||
    pm.includes('amex') ||
    pm.includes('visa') ||
    pm.includes('mastercard')
  ) {
    return true;
  }
  return false;
};

export const getSignedAmount = (tx: { amount: number; transactionType?: string | null }): number => {
  if (tx.transactionType === 'refund') return -Number(tx.amount || 0);
  if (tx.transactionType === 'transfer' || tx.transactionType === 'fixed') return 0;
  return Number(tx.amount || 0);
};

/**
 * Calculates discretionary / card consumption spend within a cycle date window.
 * Excludes transfers and fixed charges, and offsets refunds.
 */
export const calculateDiscretionarySpend = (
  transactions: FinancialTransaction[],
  startDate: string,
  endDate: string
): number => {
  return transactions.reduce((sum, tx) => {
    if (tx.transactionType === 'transfer' || tx.transactionType === 'fixed') {
      return sum;
    }

    const txDate = tx.transactionDate;
    if (startDate && txDate < startDate) return sum;
    if (endDate && txDate > endDate) return sum;

    const catLower = (tx.category || '').toLowerCase();
    if (catLower === 'investment' || catLower === 'mutual fund') return sum;

    if (!isCreditCardPayment(tx.paymentMethod)) return sum;

    const amount = Number(tx.amount) || 0;
    if (tx.transactionType === 'refund') {
      return sum - amount;
    }

    return sum + amount;
  }, 0);
};

/**
 * Calculates sum of spending occurring specifically on a given target date (e.g. today).
 */
export const calculateDaySpend = (
  transactions: FinancialTransaction[],
  targetDateStr: string
): number => {
  return transactions.reduce((sum, tx) => {
    if (tx.transactionType === 'transfer' || tx.transactionType === 'fixed') {
      return sum;
    }
    if (tx.transactionDate !== targetDateStr) {
      return sum;
    }
    const catLower = (tx.category || '').toLowerCase();
    if (catLower === 'investment' || catLower === 'mutual fund') return sum;
    if (!isCreditCardPayment(tx.paymentMethod)) return sum;

    const amount = Number(tx.amount) || 0;
    if (tx.transactionType === 'refund') {
      return sum - amount;
    }
    return sum + amount;
  }, 0);
};

/**
 * Aggregates daily expenditures over a given date range.
 */
export const computeDailySpendTimeline = (
  transactions: FinancialTransaction[],
  startDate: string,
  endDate: string
): DailyTrendPoint[] => {
  const filtered = transactions.filter((tx) => tx.transactionType !== 'transfer');

  const dailySpendMap = filtered.reduce((map, tx) => {
    const date = tx.transactionDate;
    map[date] = (map[date] || 0) + getSignedAmount(tx);
    return map;
  }, {} as Record<string, number>);

  const chronologicalDates = getDatesInRange(startDate, endDate);

  return chronologicalDates.map((date) => ({
    date,
    amount: dailySpendMap[date] || 0,
  }));
};

/**
 * Computes salary allocation bucket details.
 */
export const computeSalaryAllocation = (
  transactions: FinancialTransaction[],
  billingCycleRange: { start: string; end: string },
  expectedSalary: number,
  fixedCharges?: FixedCharge[]
): SalaryAllocationResult => {
  const allocationTransactions = transactions.filter((tx) => {
    if (tx.transactionDate < billingCycleRange.start) return false;
    if (tx.transactionDate > billingCycleRange.end) return false;
    return true;
  });

  const activeFixedCharges = (fixedCharges || []).filter((fc) => {
    return fc.startDate <= billingCycleRange.end && fc.endDate >= billingCycleRange.start;
  });

  const fixedMutualFundSpend = activeFixedCharges
    .filter((fc) => {
      const catLower = (fc.category || '').toLowerCase();
      return catLower === 'investment' || catLower === 'mutual fund';
    })
    .reduce((sum, fc) => sum + (Number(fc.amount) || 0), 0);

  const fixedConsumptionSpend = activeFixedCharges
    .filter((fc) => {
      const catLower = (fc.category || '').toLowerCase();
      return catLower !== 'investment' && catLower !== 'mutual fund';
    })
    .reduce((sum, fc) => sum + (Number(fc.amount) || 0), 0);

  const ledgerMutualFundSpend = allocationTransactions
    .filter((tx) => {
      const catLower = (tx.category || '').toLowerCase();
      return catLower === 'investment' || catLower === 'mutual fund';
    })
    .reduce((sum, tx) => sum + getSignedAmount(tx), 0);

  const mutualFundSpend = ledgerMutualFundSpend + fixedMutualFundSpend;

  const ledgerConsumptionSpend = allocationTransactions
    .filter((tx) => {
      if (tx.transactionType === 'transfer' || tx.transactionType === 'fixed') return false;
      const catLower = (tx.category || '').toLowerCase();
      if (catLower === 'investment' || catLower === 'mutual fund') return false;
      return isCreditCardPayment(tx.paymentMethod);
    })
    .reduce((sum, tx) => sum + getSignedAmount(tx), 0);

  const bankDebitTotal = allocationTransactions
    .filter((tx) => {
      if (tx.transactionType === 'transfer' || tx.transactionType === 'fixed') return false;
      const catLower = (tx.category || '').toLowerCase();
      if (catLower === 'investment' || catLower === 'mutual fund') return false;
      return !isCreditCardPayment(tx.paymentMethod);
    })
    .reduce((sum, tx) => sum + getSignedAmount(tx), 0);

  const consumptionSpend = ledgerConsumptionSpend + fixedConsumptionSpend;
  const totalSaved = Math.max(0, expectedSalary - mutualFundSpend - consumptionSpend);

  const mutualFundPercent = expectedSalary > 0 ? (mutualFundSpend / expectedSalary) * 100 : 0;
  const consumptionPercent = expectedSalary > 0 ? (consumptionSpend / expectedSalary) * 100 : 0;
  const unspentPercent = Math.max(0, 100 - mutualFundPercent - consumptionPercent);

  return {
    mutualFundSpend,
    consumptionSpend,
    totalSaved,
    mutualFundPercent,
    consumptionPercent,
    unspentPercent,
    allocationTransactions,
    bankDebitTotal,
  };
};
