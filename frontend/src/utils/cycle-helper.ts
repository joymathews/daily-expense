export interface UserCycleFrontend {
  id: string;
  cycleName: string;
  startType: 'default' | 'transaction' | 'date';
  startTransactionId?: string;
  startDate: string;        // YYYY-MM-DD
  startTimestamp: string;   // ISO8601 string
  endDate: string | null;   // YYYY-MM-DD or null if active
  endTimestamp: string | null; // ISO8601 string or null if active
  totalDays: number | null; // null if active
  isCurrent: boolean;
}

export interface TransactionWithTimestamps {
  amount: number;
  transactionDate: string;  // YYYY-MM-DD
  category: string;
  transactionType?: string | null;
  paymentMethod?: string;
  sourceReceivedAt?: string;
  createdAt?: string;
}

/**
 * Evaluates transaction timestamp against cycle boundary timestamps.
 * Handles intra-day ordering on cycle start dates using sourceReceivedAt or createdAt.
 */
export const filterTransactionsByCycle = <T extends TransactionWithTimestamps>(
  transactions: T[],
  cycle: UserCycleFrontend | null | undefined
): T[] => {
  if (!cycle) return transactions;

  const cycleStartMs = new Date(cycle.startTimestamp).getTime();
  const cycleEndMs = cycle.endTimestamp ? new Date(cycle.endTimestamp).getTime() : null;

  return transactions.filter(tx => {
    let txMs: number;

    if (tx.sourceReceivedAt) {
      txMs = new Date(tx.sourceReceivedAt).getTime();
    } else {
      // Fallback to start of day UTC for date-only transactions
      const parts = tx.transactionDate.split('-').map(Number);
      if (parts.length >= 3) {
        txMs = Date.UTC(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
      } else {
        txMs = new Date(tx.transactionDate).getTime();
      }
    }

    if (isNaN(txMs)) return false;

    // Check start boundary
    if (txMs < cycleStartMs) return false;

    // Check end boundary if closed cycle
    if (cycleEndMs !== null && txMs > cycleEndMs) return false;

    return true;
  });
};

/**
 * Returns formatted display label for a cycle (e.g., "Jun 28 – Jul 30, 2026 (33 days)")
 */
export const formatCycleLabel = (cycle: UserCycleFrontend): string => {
  if (!cycle) return '';
  if (cycle.isCurrent || cycle.endTimestamp === null) {
    return `${cycle.startDate} – Present (Active Cycle)`;
  }
  const daysStr = cycle.totalDays ? ` (${cycle.totalDays} days)` : '';
  return `${cycle.cycleName}${daysStr}`;
};

/**
 * Checks if a cycle is currently active
 */
export const isActiveCycle = (cycle: UserCycleFrontend | null | undefined): boolean => {
  if (!cycle) return false;
  return cycle.isCurrent || cycle.endTimestamp === null;
};
