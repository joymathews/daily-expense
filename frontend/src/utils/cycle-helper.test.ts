import { describe, it, expect } from 'vitest';
import { filterTransactionsByCycle, formatCycleLabel, isActiveCycle, UserCycleFrontend } from './cycle-helper';

describe('Cycle Helper Utilities [FUNC-CYCLE-1, FUNC-CYCLE-2, FUNC-CYCLE-3, FUNC-CYCLE-5]', () => {
  const activeCycle: UserCycleFrontend = {
    id: 'cycle-active-1',
    cycleName: '28 Jun – Present',
    startType: 'transaction',
    startDate: '2026-06-28',
    startTimestamp: '2026-06-28T11:00:00.000Z',
    endDate: null,
    endTimestamp: null,
    totalDays: null,
    isCurrent: true,
  };

  const closedCycle: UserCycleFrontend = {
    id: 'cycle-closed-1',
    cycleName: '17 May – 27 Jun \'26',
    startType: 'default',
    startDate: '2026-05-17',
    startTimestamp: '2026-05-17T00:00:00.000Z',
    endDate: '2026-06-27',
    endTimestamp: '2026-06-28T10:59:59.999Z',
    totalDays: 42,
    isCurrent: false,
  };

  it('filters transactions by cycle timestamps with intra-day precision [FUNC-CYCLE-3]', () => {
    const transactions = [
      {
        transactionDate: '2026-06-28',
        amount: 250,
        category: 'Food',
        sourceReceivedAt: '2026-06-28T08:30:00.000Z', // Before anchor 11:00 AM -> Belongs to closed cycle
      },
      {
        transactionDate: '2026-06-28',
        amount: 100000,
        category: 'Income',
        sourceReceivedAt: '2026-06-28T11:00:00.000Z', // Payday anchor -> Belongs to active cycle
      },
      {
        transactionDate: '2026-06-28',
        amount: 1800,
        category: 'Dining',
        sourceReceivedAt: '2026-06-28T19:30:00.000Z', // Evening spend -> Belongs to active cycle
      },
    ];

    const activeResults = filterTransactionsByCycle(transactions, activeCycle);
    expect(activeResults.length).toBe(2);
    expect(activeResults[0].amount).toBe(100000);
    expect(activeResults[1].amount).toBe(1800);

    const closedResults = filterTransactionsByCycle(transactions, closedCycle);
    expect(closedResults.length).toBe(1);
    expect(closedResults[0].amount).toBe(250);
  });

  it('correctly identifies active cycle status [FUNC-CYCLE-5]', () => {
    expect(isActiveCycle(activeCycle)).toBe(true);
    expect(isActiveCycle(closedCycle)).toBe(false);
  });

  it('formats cycle UI display labels [FUNC-CYCLE-5]', () => {
    expect(formatCycleLabel(activeCycle)).toContain('Present');
    expect(formatCycleLabel(closedCycle)).toContain('42 days');
  });
});
