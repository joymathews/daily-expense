import {
  FinancialTransaction,
  DayPeakPoint,
  DayOfWeekPeakPoint,
  PeakAveragesResult,
} from './types';

/**
 * Group expenses by day of the month (1-31) to identify recurring monthly peaks and weekend ratios.
 */
export const calculateDayOfMonthPeaks = (transactions: FinancialTransaction[]): DayPeakPoint[] => {
  const daysMap: Record<number, number> = {};
  const weekendDaysMap: Record<number, number> = {};
  for (let i = 1; i <= 31; i++) {
    daysMap[i] = 0;
    weekendDaysMap[i] = 0;
  }

  transactions
    .filter((tx) => {
      if (tx.transactionType === 'transfer') return false;
      if (tx.transactionType === 'fixed') return false;
      const catLower = (tx.category || '').toLowerCase();
      return catLower !== 'investment' && catLower !== 'mutual fund';
    })
    .forEach((tx) => {
      const parts = tx.transactionDate.split('-');
      if (parts.length === 3) {
        const dayNum = parseInt(parts[2], 10);
        if (dayNum >= 1 && dayNum <= 31) {
          const amount = tx.transactionType === 'refund' ? -Number(tx.amount || 0) : Number(tx.amount || 0);
          daysMap[dayNum] += amount;

          // Check if transaction fell on a weekend: Fri (5), Sat (6), or Sun (0)
          const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, dayNum);
          const dayOfWeek = dateObj.getDay();
          if (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) {
            weekendDaysMap[dayNum] += amount;
          }
        }
      }
    });

  return Object.keys(daysMap)
    .map((k) => {
      const day = parseInt(k, 10);
      return {
        day,
        amount: daysMap[day],
        weekendAmount: weekendDaysMap[day],
      };
    })
    .sort((a, b) => a.day - b.day);
};

/**
 * Group expenses by day of the week (Sun-Sat) to identify weekly behavior.
 */
export const calculateDayOfWeekPeaks = (transactions: FinancialTransaction[]): DayOfWeekPeakPoint[] => {
  const jsDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const sortedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const dayNamesMap: Record<string, number> = {};
  sortedDays.forEach((name) => {
    dayNamesMap[name] = 0;
  });

  transactions
    .filter((tx) => {
      if (tx.transactionType === 'transfer') return false;
      if (tx.transactionType === 'fixed') return false;
      const catLower = (tx.category || '').toLowerCase();
      return catLower !== 'investment' && catLower !== 'mutual fund';
    })
    .forEach((tx) => {
      const parts = tx.transactionDate.split('-').map(Number);
      if (parts.length === 3) {
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        const name = jsDays[dateObj.getDay()];
        const amount = tx.transactionType === 'refund' ? -Number(tx.amount || 0) : Number(tx.amount || 0);
        dayNamesMap[name] += amount;
      }
    });

  return sortedDays.map((name) => ({
    dayName: name,
    amount: dayNamesMap[name],
  }));
};

/**
 * Calculates baseline averages for day of month (31 days) and day of week (7 days) peaks.
 */
export const calculatePeakAverages = (
  dayOfMonthPeaks: DayPeakPoint[] = [],
  dayOfWeekPeaks: DayOfWeekPeakPoint[] = []
): PeakAveragesResult => {
  const totalDOMAmount = (dayOfMonthPeaks || []).reduce((sum, p) => sum + (p.amount || 0), 0);
  const avgDOMAmount = totalDOMAmount / 31;

  const totalDOWAmount = (dayOfWeekPeaks || []).reduce((sum, p) => sum + (p.amount || 0), 0);
  const avgDOWAmount = totalDOWAmount / 7;

  return {
    totalDOMAmount,
    avgDOMAmount,
    totalDOWAmount,
    avgDOWAmount,
  };
};

/**
 * Calculates percentage deviation of an amount from a baseline average.
 */
export const calculatePeakPercentDeviation = (amount: number, average: number): number => {
  if (average <= 0) return 0;
  return Math.round(((amount - average) / average) * 100);
};

/**
 * Formats text for percentage variance relative to average (e.g. " (+45% vs Avg)", " (-20% vs Avg)", or " (Avg)").
 */
export const getPeakPercentDeviationText = (amount: number, average: number): string => {
  if (average <= 0) return '';
  const diffPct = calculatePeakPercentDeviation(amount, average);
  if (diffPct === 0) return ' (Avg)';
  return ` (${diffPct > 0 ? '+' : ''}${diffPct}% vs Avg)`;
};

/**
 * Re-indexes day of month peaks chronologically starting from billing cycle start day.
 */
export const orderDOMPeaksByBillingCycle = (
  dayOfMonthPeaks: DayPeakPoint[] = [],
  billingCycleStartDay: number = 17
): DayPeakPoint[] => {
  if (!Array.isArray(dayOfMonthPeaks)) return [];
  return [
    ...dayOfMonthPeaks.filter((p) => p.day >= billingCycleStartDay),
    ...dayOfMonthPeaks.filter((p) => p.day < billingCycleStartDay),
  ];
};
