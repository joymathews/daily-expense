import { UserCycle, CycleRange, FinancialTransaction } from './types';

/**
 * Calculates inclusive difference in calendar days between two YYYY-MM-DD date strings.
 */
export const getDaysDiff = (startDateStr: string, endDateStr: string): number => {
  if (!startDateStr || !endDateStr) return 0;
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  const diffTime = end.getTime() - start.getTime();
  if (diffTime < 0) return 0;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
};

/**
 * Computes active cycle range from billing cycle start day.
 */
export const getActiveCycleRange = (billingCycleStartDay: number = 17, referenceDate: Date = new Date()): CycleRange => {
  const currentDay = referenceDate.getDate();
  const currentMonth = referenceDate.getMonth();
  const currentYear = referenceDate.getFullYear();

  let startYear = currentYear;
  let startMonth = currentMonth;

  if (currentDay <= billingCycleStartDay) {
    startMonth = currentMonth - 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear -= 1;
    }
  }

  const startDate = new Date(startYear, startMonth, billingCycleStartDay);

  let endMonth = startMonth + 1;
  let endYear = startYear;
  if (endMonth > 11) {
    endMonth = 0;
    endYear += 1;
  }
  const endDay = Math.min(31, billingCycleStartDay);
  const endDate = new Date(endYear, endMonth, endDay);

  const format = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  return {
    start: format(startDate),
    end: format(endDate),
  };
};

/**
 * Compute the date range of a cycle with a given monthly offset relative to the current active cycle.
 */
export const getCycleRangeForOffset = (billingCycleStartDay: number = 17, offset: number = 0, referenceDate: Date = new Date()): CycleRange => {
  const active = getActiveCycleRange(billingCycleStartDay, referenceDate);
  const startParts = active.start.split('-').map(Number);
  
  // Use local Date to avoid UTC timezone shifts
  const baseStart = new Date(startParts[0], startParts[1] - 1, startParts[2]);
  
  // Calculate target start date by adding/subtracting months
  const startDate = new Date(baseStart.getFullYear(), baseStart.getMonth() + offset, billingCycleStartDay);
  const endDay = Math.min(31, billingCycleStartDay + 1);
  const endDate = new Date(baseStart.getFullYear(), baseStart.getMonth() + offset + 1, endDay);
  
  const formatDateStr = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  return {
    start: formatDateStr(startDate),
    end: formatDateStr(endDate),
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

/**
 * Returns expected cycle end date (+1 day beyond targetStartDay of next month) for an open active cycle.
 */
export const getExpectedCycleEnd = (startDateStr: string, billingCycleStartDay: number = 17): string => {
  if (!startDateStr) return new Date().toISOString().split('T')[0];
  const parts = startDateStr.split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
    return startDateStr;
  }

  const startYear = parts[0];
  const startMonthIndex = parts[1] - 1;

  let endMonthIndex = startMonthIndex + 1;
  let endYear = startYear;
  if (endMonthIndex > 11) {
    endMonthIndex = 0;
    endYear += 1;
  }

  const endDay = Math.min(31, billingCycleStartDay);
  const endDate = new Date(endYear, endMonthIndex, endDay);
  const y = endDate.getFullYear();
  const m = String(endDate.getMonth() + 1).padStart(2, '0');
  const d = String(endDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Filter transactions falling inside a specific user cycle with intra-day boundary support.
 */
export const filterTransactionsByCycle = <T extends FinancialTransaction>(
  transactions: T[],
  cycle: UserCycle | null | undefined
): T[] => {
  if (!cycle) return transactions;
  const startIso = cycle.startTimestamp || `${cycle.startDate}T00:00:00.000Z`;
  const endIso = cycle.endTimestamp || (cycle.endDate ? `${cycle.endDate}T23:59:59.999Z` : null);

  const cycleStartMs = new Date(startIso).getTime();
  const cycleEndMs = endIso ? new Date(endIso).getTime() : null;

  return transactions.filter((tx) => {
    let txMs: number;
    if (tx.sourceReceivedAt) {
      txMs = new Date(tx.sourceReceivedAt).getTime();
    } else {
      const parts = tx.transactionDate.split('-').map(Number);
      if (parts.length >= 3) {
        txMs = Date.UTC(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
      } else {
        txMs = new Date(tx.transactionDate).getTime();
      }
    }

    if (isNaN(txMs)) return false;
    if (txMs < cycleStartMs) return false;
    if (cycleEndMs !== null && txMs > cycleEndMs) return false;
    return true;
  });
};

/**
 * Returns formatted display label for a cycle.
 */
export const formatCycleLabel = (cycle: UserCycle): string => {
  if (!cycle) return '';
  if (cycle.isCurrent || cycle.endTimestamp === null) {
    return `${cycle.startDate} – Present (Active Cycle)`;
  }
  const daysStr = cycle.totalDays ? ` (${cycle.totalDays} days)` : '';
  return `${cycle.cycleName}${daysStr}`;
};

/**
 * Checks if a cycle is currently active.
 */
export const isActiveCycle = (cycle: UserCycle | null | undefined): boolean => {
  if (!cycle) return false;
  return cycle.isCurrent || cycle.endTimestamp === null;
};
