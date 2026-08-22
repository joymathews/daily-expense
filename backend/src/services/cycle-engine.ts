export interface UserCycle {
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

export interface CycleOverride {
  id: string;
  userId: string;
  cycleName?: string;
  startType: 'default' | 'transaction' | 'date';
  startTransactionId?: string;
  startDate: string;
  startTimestamp: string;
  endDate?: string | null;
  endTimestamp?: string | null;
  createdAt?: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const formatCycleDisplayDate = (dateStr: string): string => {
  const parts = dateStr.split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return dateStr;
  const monthName = MONTH_NAMES[parts[1] - 1] || parts[1];
  const shortYear = String(parts[0]).slice(2);
  return `${parts[2]} ${monthName} '${shortYear}`;
};

export const formatDateYYYYMMDD = (d: Date): string => {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};


/**
 * Generates default recurring monthly cycles anchored to defaultStartDay (e.g. 17)
 * over a given range of relative months (-12 to +1 month from reference Date).
 */
export const generateDefaultCycles = (defaultStartDay: number = 17, referenceDate: Date = new Date()): UserCycle[] => {
  const cycles: UserCycle[] = [];
  const startDay = Math.min(Math.max(1, defaultStartDay), 28);
  const refYear = referenceDate.getUTCFullYear();
  const refMonth = referenceDate.getUTCMonth();

  // Generate default cycles up to current cycle (exclude future cycles)
  for (let offset = -12; offset <= 0; offset++) {
    const sDate = new Date(Date.UTC(refYear, refMonth + offset, startDay, 0, 0, 0, 0));
    const eDate = new Date(Date.UTC(refYear, refMonth + offset + 1, startDay, 0, 0, 0, 0));

    
    // Day before next start
    const endBoundaryDate = new Date(eDate.getTime() - 1); // 23:59:59.999 of day before

    const startDateStr = formatDateYYYYMMDD(sDate);
    const endDateStr = formatDateYYYYMMDD(endBoundaryDate);
    const displayEndDateStr = formatDateYYYYMMDD(eDate);

    const startIso = sDate.toISOString();
    const endIso = endBoundaryDate.toISOString();

    const totalDays = Math.round((endBoundaryDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    cycles.push({
      id: `default-${startDateStr}`,
      cycleName: `${formatCycleDisplayDate(startDateStr)} – ${formatCycleDisplayDate(displayEndDateStr)}`,
      startType: 'default',
      startDate: startDateStr,
      startTimestamp: startIso,
      endDate: endDateStr,
      endTimestamp: endIso,
      totalDays,
      isCurrent: false,
    });
  }

  return cycles;
};

/**
 * Builds the dynamic chained cycle list by overlaying user overrides onto default cycles,
 * sorting by startTimestamp ASC, chaining end boundaries, and determining the active cycle.
 */
export const buildUserCycleList = (
  defaultStartDay: number = 17,
  overrides: CycleOverride[] = [],
  referenceDate: Date = new Date(),
  lastTxTimestamp?: string
): UserCycle[] => {
  const defaultCycles = generateDefaultCycles(defaultStartDay, referenceDate);
  
  // Track override year-months (e.g. "2026-06")
  const overrideYearMonths = new Set(overrides.map(ov => ov.startDate.slice(0, 7)));

  // Keep default cycles except for months that have explicit overrides
  const activeDefaultCycles = defaultCycles.filter(c => !overrideYearMonths.has(c.startDate.slice(0, 7)));

  const cycleMap = new Map<string, UserCycle>();
  for (const c of activeDefaultCycles) {
    cycleMap.set(c.startDate, c);
  }

  // Apply overrides
  for (const ov of overrides) {
    const startDate = ov.startDate;
    const startIso = ov.startTimestamp || `${startDate}T00:00:00.000Z`;

    cycleMap.set(startDate, {
      id: ov.id || `override-${startDate}`,
      cycleName: ov.cycleName || `Cycle from ${formatCycleDisplayDate(startDate)}`,
      startType: ov.startType,
      startTransactionId: ov.startTransactionId,
      startDate,
      startTimestamp: startIso,
      endDate: null,
      endTimestamp: null,
      totalDays: null,
      isCurrent: false,
    });
  }

  // Sort cycles by startTimestamp ascending
  const sortedCycles = Array.from(cycleMap.values()).sort((a, b) => {
    return new Date(a.startTimestamp).getTime() - new Date(b.startTimestamp).getTime();
  });


  const nowMs = referenceDate.getTime();
  let currentCycleIndex = -1;

  // Find active cycle index (latest cycle with startTimestamp <= referenceDate or latest overall)
  for (let i = 0; i < sortedCycles.length; i++) {
    const cycleStartMs = new Date(sortedCycles[i].startTimestamp).getTime();
    if (cycleStartMs <= nowMs) {
      currentCycleIndex = i;
    }
  }

  if (currentCycleIndex === -1 && sortedCycles.length > 0) {
    currentCycleIndex = sortedCycles.length - 1;
  }

  // Chain end timestamps
  const finalCycles: UserCycle[] = sortedCycles.map((cycle, index) => {
    const isCurrent = index === currentCycleIndex;

    if (isCurrent) {
      // Active cycle: end date/timestamp is null
      return {
        ...cycle,
        cycleName: `${formatCycleDisplayDate(cycle.startDate)} – Present`,
        endDate: null,
        endTimestamp: null,
        totalDays: null,
        isCurrent: true,
      };
    }

    const nextCycle = sortedCycles[index + 1];
    if (nextCycle) {
      // Historical cycle ends 1ms before next cycle starts
      const nextStartMs = new Date(nextCycle.startTimestamp).getTime();
      const endBoundaryMs = nextStartMs - 1;
      const endBoundaryDate = new Date(endBoundaryMs);
      const endDateStr = formatDateYYYYMMDD(endBoundaryDate);
      const endIso = endBoundaryDate.toISOString();
      const startMs = new Date(cycle.startTimestamp).getTime();
      const totalDays = Math.max(1, Math.round((endBoundaryMs - startMs) / (1000 * 60 * 60 * 24)) + 1);

      return {
        ...cycle,
        cycleName: `${formatCycleDisplayDate(cycle.startDate)} – ${formatCycleDisplayDate(nextCycle.startDate)}`,
        endDate: endDateStr,
        endTimestamp: endIso,
        totalDays,
        isCurrent: false,
      };
    }

    // Future cycle after current
    return {
      ...cycle,
      isCurrent: false,
    };
  });

  // Return descending (most recent cycle first) for drop-down lists
  return finalCycles.reverse();
};
