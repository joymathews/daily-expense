export interface HasAmountAndTransactionType {
  amount: number;
  transactionType?: string | null;
}

export interface HelperTransaction {
  amount: number;
  transactionDate: string;
  category: string;
  transactionType?: string | null;
  paymentMethod?: string;
}

/**
 * Formats ISO timestamp or date-only string into user local time (12-hour AM/PM format)
 */
export const formatLocalTransactionTime = (isoString?: string): string | null => {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return null;
  // Date-only UTC fallback (00:00:00.000Z) returns null
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
    return null;
  }
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
};

export const getSignedAmount = (t: HasAmountAndTransactionType): number => {
  if (t.transactionType === 'refund') return -t.amount;
  if (t.transactionType === 'transfer') return 0;
  if (t.transactionType === 'fixed') return 0;
  return t.amount;
};

/**
 * Helper to identify if a transaction's payment method is a credit card or deferred liability card
 * (e.g. HDFC Credit Card, RuPay Credit Card) vs direct bank debit (UPI, Cash, Debit Card).
 */
export const isCreditCardPayment = (paymentMethod?: string): boolean => {
  if (!paymentMethod || paymentMethod.trim() === '') return true; // Fallback for backwards compatibility
  const pm = paymentMethod.toLowerCase();
  if (pm.includes('debit')) return false;
  if (pm.includes('bank')) return false;
  if (pm.includes('upi')) return false;
  if (pm.includes('cash')) return false;
  if (pm.includes('credit') || pm.includes('cc') || pm.includes('rupay') || pm.includes('card') || pm.includes('hdfc') || pm.includes('amex') || pm.includes('visa') || pm.includes('mastercard')) {
    return true;
  }
  return false;
};

/**
 * Compute active billing cycle dates based on cycle start day
 */
export const getActiveCycleRange = (startDay: number) => {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-indexed (Jan = 0)
  const currentDay = today.getDate();

  let startDate: Date;
  let endDate: Date;

  if (currentDay >= startDay) {
    // Current cycle started in this month
    startDate = new Date(currentYear, currentMonth, startDay);
    // Ends next month on the same day
    endDate = new Date(currentYear, currentMonth + 1, startDay);
  } else {
    // Current cycle started in last month
    startDate = new Date(currentYear, currentMonth - 1, startDay);
    endDate = new Date(currentYear, currentMonth, startDay);
  }

  // Format as YYYY-MM-DD (local timezone safe)
  const formatDate = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  return {
    start: formatDate(startDate),
    end: formatDate(endDate)
  };
};

/**
 * Compute the date range of a cycle with a given monthly offset relative to the current active cycle.
 * e.g., offset = -1 for previous cycle, offset = -2 for two cycles ago.
 */
export const getCycleRangeForOffset = (startDay: number, offset: number) => {
  const active = getActiveCycleRange(startDay);
  const startParts = active.start.split('-').map(Number);
  
  // Use local Date to avoid UTC timezone shifts
  const baseStart = new Date(startParts[0], startParts[1] - 1, startParts[2]);
  
  // Calculate target start date by adding/subtracting months
  const startDate = new Date(baseStart.getFullYear(), baseStart.getMonth() + offset, startDay);
  const endDate = new Date(baseStart.getFullYear(), baseStart.getMonth() + offset + 1, startDay);
  
  const formatDate = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  return {
    start: formatDate(startDate),
    end: formatDate(endDate)
  };
};

/**
 * Generate a list of continuous YYYY-MM-DD date strings in a range (inclusive)
 */
export const getDatesInRange = (startStr: string, endStr: string): string[] => {
  const dates: string[] = [];
  if (!startStr || !endStr) return dates;
  
  const startParts = startStr.split('-').map(Number);
  const endParts = endStr.split('-').map(Number);
  if (startParts.length < 3 || endParts.length < 3) return dates;

  let current = new Date(startParts[0], startParts[1] - 1, startParts[2]);
  const end = new Date(endParts[0], endParts[1] - 1, endParts[2]);
  
  if (current > end) return dates;
  
  let limit = 0;
  while (current <= end && limit < 366) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
    limit++;
  }
  return dates;
};

export interface FixedChargeTemplate {
  id: string;
  userId: string;
  name: string;
  amount: number;
  currency: string;
  category: string;
  startDate: string;
  endDate: string;
  paymentMethod?: string;
}

export interface SalaryAllocationResult {
  mutualFundSpend: number;
  consumptionSpend: number;
  totalSaved: number;
  mutualFundPercent: number;
  consumptionPercent: number;
  unspentPercent: number;
  allocationTransactions: HelperTransaction[];
  bankDebitTotal: number;
}

/**
 * Computes salary allocation bucket details
 */
export const computeSalaryAllocation = (
  transactions: HelperTransaction[],
  billingCycleRange: { start: string; end: string },
  expectedSalary: number,
  fixedCharges?: FixedChargeTemplate[]
): SalaryAllocationResult => {
  const allocationTransactions = transactions.filter(tx => {
    if (tx.transactionDate < billingCycleRange.start) return false;
    if (tx.transactionDate > billingCycleRange.end) return false;
    return true;
  });

  const activeFixedCharges = (fixedCharges || []).filter(fc => {
    return fc.startDate <= billingCycleRange.end && fc.endDate >= billingCycleRange.start;
  });

  const fixedMutualFundSpend = activeFixedCharges
    .filter(fc => {
      const catLower = (fc.category || '').toLowerCase();
      return catLower === 'investment' || catLower === 'mutual fund';
    })
    .reduce((sum, fc) => sum + fc.amount, 0);

  const fixedConsumptionSpend = activeFixedCharges
    .filter(fc => {
      const catLower = (fc.category || '').toLowerCase();
      return catLower !== 'investment' && catLower !== 'mutual fund';
    })
    .reduce((sum, fc) => sum + fc.amount, 0);

  const ledgerMutualFundSpend = allocationTransactions
    .filter(tx => {
      const catLower = (tx.category || '').toLowerCase();
      return catLower === 'investment' || catLower === 'mutual fund';
    })
    .reduce((sum, tx) => sum + getSignedAmount(tx), 0);

  const mutualFundSpend = ledgerMutualFundSpend + fixedMutualFundSpend;

  const ledgerConsumptionSpend = allocationTransactions
    .filter(tx => {
      if (tx.transactionType === 'transfer' || tx.transactionType === 'fixed') return false;
      const catLower = (tx.category || '').toLowerCase();
      if (catLower === 'investment' || catLower === 'mutual fund') return false;
      // Exclude direct bank debits from salary consumption spend
      return isCreditCardPayment(tx.paymentMethod);
    })
    .reduce((sum, tx) => sum + getSignedAmount(tx), 0);

  const bankDebitTotal = allocationTransactions
    .filter(tx => {
      if (tx.transactionType === 'transfer' || tx.transactionType === 'fixed') return false;
      const catLower = (tx.category || '').toLowerCase();
      if (catLower === 'investment' || catLower === 'mutual fund') return false;
      // Keep only direct bank debits
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
    bankDebitTotal
  };
};

export interface DailyTrendPoint {
  date: string;
  amount: number;
}

/**
 * Aggregates daily expenditures over a given date range
 */
export const computeDailySpendTimeline = (
  transactions: HelperTransaction[],
  startDate: string,
  endDate: string
): DailyTrendPoint[] => {
  // Filter out transfers
  const filtered = transactions.filter(tx => tx.transactionType !== 'transfer');

  // Group by date
  const dailySpendMap = filtered.reduce((map, tx) => {
    const date = tx.transactionDate;
    map[date] = (map[date] || 0) + getSignedAmount(tx);
    return map;
  }, {} as Record<string, number>);

  // Get continuous dates
  const chronologicalDates = getDatesInRange(startDate, endDate);
  
  return chronologicalDates.map(date => ({
    date,
    amount: dailySpendMap[date] || 0
  }));
};

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
  'Other'
];


