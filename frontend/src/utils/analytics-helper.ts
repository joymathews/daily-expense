import { getSignedAmount, isCreditCardPayment } from './transaction-helper';
import type { HelperTransaction } from './transaction-helper';

export interface RunRateForecastResult {
  targetBudget: number;
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  dailyVelocity: number;
  projectedSpend: number;
  isExceeding: boolean;
  exhaustionDate: string | null;
  recommendedDailyRate: number;
}

export interface DayPeakPoint {
  day: number;
  amount: number;
}

export interface DayOfWeekPeakPoint {
  dayName: string;
  amount: number;
}

export interface RecurringBillPrediction {
  merchant: string;
  averageAmount: number;
  frequencyDays: number;
  lastDate: string;
  predictedNextDate: string;
  historyCount: number;
  allIntervals: number[];
  allDates: string[];
}

/**
 * Filter out transfers, investments, and fixed charges to calculate pure discretionary spending.
 */
export const calculateDiscretionarySpend = (
  transactions: HelperTransaction[],
  startDate: string,
  endDate: string
): number => {
  return transactions
    .filter(tx => {
      if (tx.transactionDate < startDate || tx.transactionDate > endDate) return false;
      if (tx.transactionType === 'transfer') return false;
      if (tx.transactionType === 'fixed') return false;
      
      const catLower = (tx.category || '').toLowerCase();
      if (catLower === 'investment' || catLower === 'mutual fund') return false;

      // Exclude direct bank debits
      return isCreditCardPayment(tx.paymentMethod);
    })
    .reduce((sum, tx) => sum + getSignedAmount(tx), 0);
};

/**
 * Compute the number of days between two YYYY-MM-DD date strings (inclusive)
 */
export const getDaysDiff = (startStr: string, endStr: string): number => {
  if (!startStr || !endStr) return 0;
  const start = new Date(startStr);
  const end = new Date(endStr);
  const diffTime = end.getTime() - start.getTime();
  if (diffTime < 0) return 0;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
};

/**
 * Projects end of cycle expenditures and forecasts budget exhaustion dates.
 */
export const calculateRunRateForecast = (
  discretionarySpend: number,
  expectedSalary: number,
  targetBudgetPercent: number,
  cycleRange: { start: string; end: string },
  todayStr: string
): RunRateForecastResult => {
  const targetBudget = Math.round(expectedSalary * (targetBudgetPercent / 100));
  const totalDays = getDaysDiff(cycleRange.start, cycleRange.end) || 30;
  
  // Bound todayStr to cycle range limits
  let adjustedToday = todayStr;
  if (todayStr < cycleRange.start) adjustedToday = cycleRange.start;
  if (todayStr > cycleRange.end) adjustedToday = cycleRange.end;
  
  const elapsedDays = getDaysDiff(cycleRange.start, adjustedToday) || 1;
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  
  const dailyVelocity = Math.max(0, discretionarySpend / elapsedDays);
  const projectedSpend = Math.round(dailyVelocity * totalDays);
  const isExceeding = projectedSpend > targetBudget;
  
  let exhaustionDate: string | null = null;
  if (isExceeding && dailyVelocity > 0) {
    const daysUntilExhaustion = targetBudget / dailyVelocity;
    const start = new Date(cycleRange.start);
    start.setDate(start.getDate() + Math.floor(daysUntilExhaustion));
    
    const year = start.getFullYear();
    const month = String(start.getMonth() + 1).padStart(2, '0');
    const day = String(start.getDate()).padStart(2, '0');
    exhaustionDate = `${year}-${month}-${day}`;
  }
  
  const remainingBudget = targetBudget - discretionarySpend;
  const recommendedDailyRate = remainingDays > 0 
    ? Math.max(0, remainingBudget / remainingDays) 
    : 0;

  return {
    targetBudget,
    totalDays,
    elapsedDays,
    remainingDays,
    dailyVelocity,
    projectedSpend,
    isExceeding,
    exhaustionDate,
    recommendedDailyRate
  };
};

/**
 * Group expenses by day of the month (1-31) to identify recurring monthly peaks.
 */
export const calculateDayOfMonthPeaks = (transactions: HelperTransaction[]): DayPeakPoint[] => {
  const daysMap: Record<number, number> = {};
  for (let i = 1; i <= 31; i++) {
    daysMap[i] = 0;
  }
  
  transactions
    .filter(tx => {
      if (tx.transactionType === 'transfer') return false;
      if (tx.transactionType === 'fixed') return false;
      const catLower = (tx.category || '').toLowerCase();
      return catLower !== 'investment' && catLower !== 'mutual fund';
    })
    .forEach(tx => {
      const parts = tx.transactionDate.split('-');
      if (parts.length === 3) {
        const dayNum = parseInt(parts[2], 10);
        if (dayNum >= 1 && dayNum <= 31) {
          daysMap[dayNum] += getSignedAmount(tx);
        }
      }
    });

  return Object.keys(daysMap).map(k => ({
    day: parseInt(k, 10),
    amount: daysMap[parseInt(k, 10)]
  })).sort((a, b) => a.day - b.day);
};

/**
 * Group expenses by day of the week (Sun-Sat) to identify weekly behavior.
 */
export const calculateDayOfWeekPeaks = (transactions: HelperTransaction[]): DayOfWeekPeakPoint[] => {
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayNamesMap: Record<string, number> = {};
  weekDays.forEach(name => {
    dayNamesMap[name] = 0;
  });
  
  transactions
    .filter(tx => {
      if (tx.transactionType === 'transfer') return false;
      if (tx.transactionType === 'fixed') return false;
      const catLower = (tx.category || '').toLowerCase();
      return catLower !== 'investment' && catLower !== 'mutual fund';
    })
    .forEach(tx => {
      const parts = tx.transactionDate.split('-').map(Number);
      if (parts.length === 3) {
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        const name = weekDays[dateObj.getDay()];
        dayNamesMap[name] += getSignedAmount(tx);
      }
    });

  return weekDays.map(name => ({
    dayName: name,
    amount: dayNamesMap[name]
  }));
};

/**
 * Normalizes a raw merchant name string to strip out transaction-specific details
 * like locations, payment methods, transaction reference codes, and suffix noise.
 */
export const normalizeMerchantName = (name: string): string => {
  if (!name) return '';
  const noiseTokens = new Set([
    'com', 'org', 'net', 'store', 'pay', 'upi', 'card', 'temp', 'ltd', 'pvt', 
    'service', 'services', 'corp', 'inc', 'llc', 'singapore', 'usa', 'uk', 
    'memship', 'membership', 'mems', 'internet', 'gbr', 'mumbai', 'bangalore', 'delhi', 'india'
  ]);
  
  // Lowercase, replace non-alphanumeric characters with spaces, then split into tokens
  const cleanStr = name.toLowerCase().replace(/[^a-z0-9]/g, ' ');
  const tokens = cleanStr.split(/\s+/).filter(t => {
    if (!t) return false;
    // Filter out purely numeric tokens (e.g. transaction/terminal IDs)
    if (/^\d+$/.test(t)) return false;
    // Filter out known noise tokens
    if (noiseTokens.has(t)) return false;
    return true;
  });
  
  const result = tokens.join('');
  return result || cleanStr.replace(/\s+/g, '');
};

export type DetectionFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

const FREQUENCY_CONFIGS = {
  weekly: { min: 6, max: 8, overdueLimit: 3 },
  biweekly: { min: 13, max: 15, overdueLimit: 5 },
  monthly: { min: 25, max: 35, overdueLimit: 10 },
  quarterly: { min: 85, max: 95, overdueLimit: 30 }
};

/**
 * Scan history to identify recurring bills (intervals based on selected frequency filter).
 * Groups transactions by Category + Normalized Merchant name to solve dirty data fragmentation.
 */
export const detectRecurringBills = (
  transactions: HelperTransaction[],
  todayStr?: string,
  frequencyFilter: DetectionFrequency = 'monthly'
): RecurringBillPrediction[] => {
  interface GroupData {
    dates: string[];
    transactions: HelperTransaction[];
  }
  const groups: Record<string, GroupData> = {};
  
  transactions
    .filter(tx => {
      // Exclude transfers, refunds, and explicitly declared fixed charges
      if (tx.transactionType === 'transfer' || tx.transactionType === 'refund' || tx.transactionType === 'fixed') return false;
      // Exclude direct bank debits
      if (!isCreditCardPayment(tx.paymentMethod)) return false;
      return !!tx.merchant && !!tx.transactionDate;
    })
    .forEach(tx => {
      const cat = tx.category || 'Other';
      const normMerchant = normalizeMerchantName(tx.merchant);
      const key = `${cat}_${normMerchant}`;
      if (!groups[key]) {
        groups[key] = {
          dates: [],
          transactions: []
        };
      }
      groups[key].dates.push(tx.transactionDate);
      groups[key].transactions.push(tx);
    });

  const recurringList: RecurringBillPrediction[] = [];
  const config = FREQUENCY_CONFIGS[frequencyFilter] || FREQUENCY_CONFIGS.monthly;

  Object.values(groups).forEach(group => {
    // Sort dates chronologically
    const sortedTxs = [...group.transactions].sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
    
    // Deduplicate same-day transactions for periodicity calculations
    const uniqueDates = Array.from(new Set(sortedTxs.map(t => t.transactionDate)));
    if (uniqueDates.length < 2) return;

    // Calculate daily intervals between consecutive unique dates
    const intervals: number[] = [];
    for (let i = 0; i < uniqueDates.length - 1; i++) {
      const d1 = new Date(uniqueDates[i]);
      const d2 = new Date(uniqueDates[i + 1]);
      const gap = Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      intervals.push(gap);
    }

    // Compute average interval
    const sumGaps = intervals.reduce((s, g) => s + g, 0);
    const avgGap = Math.round(sumGaps / intervals.length);

    // If average gap matches the selected frequency configuration bounds
    if (avgGap >= config.min && avgGap <= config.max) {
      // Average amount for these transactions
      const totalAmount = sortedTxs.reduce((s, t) => s + getSignedAmount(t), 0);
      const avgAmount = Math.round(totalAmount / sortedTxs.length);
      
      const lastTx = sortedTxs[sortedTxs.length - 1];
      const lastDateStr = lastTx.transactionDate;
      const lastDate = new Date(lastDateStr);
      lastDate.setDate(lastDate.getDate() + avgGap);

      const year = lastDate.getFullYear();
      const month = String(lastDate.getMonth() + 1).padStart(2, '0');
      const day = String(lastDate.getDate()).padStart(2, '0');
      const predictedNextDate = `${year}-${month}-${day}`;

      // Exclude predicted dates that are overdue by more than the adaptive limit
      if (todayStr) {
        const todayVal = new Date(todayStr).getTime();
        const nextVal = new Date(predictedNextDate).getTime();
        const overdueDays = Math.floor((todayVal - nextVal) / (1000 * 60 * 60 * 24));
        if (overdueDays > config.overdueLimit) {
          return;
        }
      }

      // Use the raw merchant name from the most recent transaction as display label
      recurringList.push({
        merchant: lastTx.merchant,
        averageAmount: avgAmount,
        frequencyDays: avgGap,
        lastDate: lastDateStr,
        predictedNextDate,
        historyCount: uniqueDates.length,
        allIntervals: intervals,
        allDates: uniqueDates
      });
    }
  });

  return recurringList.sort((a, b) => a.predictedNextDate.localeCompare(b.predictedNextDate));
};
