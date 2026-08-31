import {
  FinancialTransaction,
  DayPeakPoint,
  DayOfWeekPeakPoint,
  RecurringBillPrediction,
  DetectionFrequency,
  SavingsRecommendation,
  InsightsConfig,
  PeakAveragesResult,
} from './types';
import { isCreditCardPayment, getSignedAmount } from './transactions';

export const DEFAULT_INSIGHTS_CONFIG: InsightsConfig = {
  weekendPctThreshold: 50,
  categoryPctThreshold: 20,
  merchantVisitsThreshold: 5,
  largeExpensePctThreshold: 20,
  fixedBurdenPctThreshold: 45,
};

export const FREQUENCY_CONFIGS: Record<DetectionFrequency, { min: number; max: number; overdueLimit: number }> = {
  weekly: { min: 6, max: 8, overdueLimit: 3 },
  biweekly: { min: 13, max: 15, overdueLimit: 5 },
  monthly: { min: 25, max: 35, overdueLimit: 10 },
  quarterly: { min: 85, max: 95, overdueLimit: 30 },
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
    'memship', 'membership', 'mems', 'internet', 'gbr', 'mumbai', 'bangalore', 'delhi', 'india',
  ]);

  const cleanStr = name.toLowerCase().replace(/[^a-z0-9]/g, ' ');
  const tokens = cleanStr.split(/\s+/).filter((t) => {
    if (!t) return false;
    if (/^\d+$/.test(t)) return false;
    if (noiseTokens.has(t)) return false;
    return true;
  });

  const result = tokens.join('');
  return result || cleanStr.replace(/\s+/g, '');
};

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
 * Scan history to identify recurring bills across various intervals.
 */
export const detectRecurringBills = (
  transactions: FinancialTransaction[],
  todayStr?: string,
  frequencyFilter: DetectionFrequency = 'monthly'
): RecurringBillPrediction[] => {
  interface GroupData {
    dates: string[];
    transactions: FinancialTransaction[];
  }
  const groups: Record<string, GroupData> = {};

  transactions
    .filter((tx) => {
      if (tx.transactionType === 'transfer' || tx.transactionType === 'refund' || tx.transactionType === 'fixed') return false;
      if (!isCreditCardPayment(tx.paymentMethod)) return false;
      return !!tx.merchant && !!tx.transactionDate;
    })
    .forEach((tx) => {
      const cat = tx.category || 'Other';
      const normMerchant = normalizeMerchantName(tx.merchant || 'Unknown');
      const key = `${cat}_${normMerchant}`;
      if (!groups[key]) {
        groups[key] = { dates: [], transactions: [] };
      }
      groups[key].dates.push(tx.transactionDate);
      groups[key].transactions.push(tx);
    });

  const recurringList: RecurringBillPrediction[] = [];
  const config = FREQUENCY_CONFIGS[frequencyFilter] || FREQUENCY_CONFIGS.monthly;

  Object.values(groups).forEach((group) => {
    const sortedTxs = [...group.transactions].sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
    const uniqueDates = Array.from(new Set(sortedTxs.map((t) => t.transactionDate)));
    if (uniqueDates.length < 2) return;

    const intervals: number[] = [];
    for (let i = 0; i < uniqueDates.length - 1; i++) {
      const d1 = new Date(uniqueDates[i]);
      const d2 = new Date(uniqueDates[i + 1]);
      const gap = Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      intervals.push(gap);
    }

    const sumGaps = intervals.reduce((s, g) => s + g, 0);
    const avgGap = Math.round(sumGaps / intervals.length);

    if (avgGap >= config.min && avgGap <= config.max) {
      const totalAmount = sortedTxs.reduce(
        (s, t) => s + (t.transactionType === 'refund' ? -Number(t.amount || 0) : Number(t.amount || 0)),
        0
      );
      const avgAmount = Math.round(totalAmount / sortedTxs.length);

      const lastTx = sortedTxs[sortedTxs.length - 1];
      const lastDateStr = lastTx.transactionDate;
      const lastDate = new Date(lastDateStr);
      lastDate.setDate(lastDate.getDate() + avgGap);

      const year = lastDate.getFullYear();
      const month = String(lastDate.getMonth() + 1).padStart(2, '0');
      const day = String(lastDate.getDate()).padStart(2, '0');
      const predictedNextDate = `${year}-${month}-${day}`;

      if (todayStr) {
        const todayVal = new Date(todayStr).getTime();
        const nextVal = new Date(predictedNextDate).getTime();
        const overdueDays = Math.floor((todayVal - nextVal) / (1000 * 60 * 60 * 24));
        if (overdueDays > config.overdueLimit) {
          return;
        }
      }

      recurringList.push({
        merchant: lastTx.merchant || 'Unknown',
        averageAmount: avgAmount,
        frequencyDays: avgGap,
        lastDate: lastDateStr,
        predictedNextDate,
        historyCount: uniqueDates.length,
        allIntervals: intervals,
        allDates: uniqueDates,
        confidence: Math.min(0.95, 0.5 + uniqueDates.length * 0.1),
        occurrences: sortedTxs.length,
      });
    }
  });

  return recurringList.sort((a, b) => a.predictedNextDate.localeCompare(b.predictedNextDate));
};

/**
 * Generate smart savings recommendations based on historical cycles, weekend bias and periodicity.
 */
export const generateSavingsRecommendations = (
  transactions: FinancialTransaction[],
  dayOfMonthPeaks: DayPeakPoint[],
  dayOfWeekPeaks: DayOfWeekPeakPoint[],
  recurringBills: RecurringBillPrediction[],
  expectedSalary: number,
  totalFixedCharges: number,
  targetBudget: number,
  discretionarySpend: number,
  projectedCardOutlay: number,
  cycleRange: { start: string; end: string },
  _todayStr: string,
  config: InsightsConfig = DEFAULT_INSIGHTS_CONFIG
): SavingsRecommendation[] => {
  const recommendations: SavingsRecommendation[] = [];

  const getImpact = (savings: number): 'high' | 'medium' | 'low' => {
    if (savings >= 5000) return 'high';
    if (savings >= 1500) return 'medium';
    return 'low';
  };

  const rangeDiscretionary = transactions.filter((tx) => {
    if (tx.transactionDate < cycleRange.start || tx.transactionDate > cycleRange.end) return false;
    if (tx.transactionType === 'transfer' || tx.transactionType === 'fixed') return false;
    const catLower = (tx.category || '').toLowerCase();
    if (catLower === 'investment' || catLower === 'mutual fund') return false;
    return isCreditCardPayment(tx.paymentMethod);
  });

  const getSignedAmount = (tx: FinancialTransaction): number => {
    if (tx.transactionType === 'refund') return -Number(tx.amount || 0);
    if (tx.transactionType === 'transfer' || tx.transactionType === 'fixed') return 0;
    return Number(tx.amount || 0);
  };

  // 1. Optimize Subscription (recurring)
  if (recurringBills.length > 0) {
    const sortedBills = [...recurringBills].sort((a, b) => {
      const costA = a.averageAmount * (30 / a.frequencyDays);
      const costB = b.averageAmount * (30 / b.frequencyDays);
      return costB - costA;
    });
    const topBill = sortedBills[0];
    const monthlyCost = Math.round(topBill.averageAmount * (30 / topBill.frequencyDays));
    recommendations.push({
      id: 'rec-recurring',
      type: 'recurring',
      title: `Optimize Subscription: ${topBill.merchant}`,
      description: `You are spending an estimated monthly equivalent of ₹${monthlyCost.toLocaleString('en-IN')} on ${topBill.merchant}. Consider canceling or downgrading options.`,
      potentialSavings: monthlyCost,
      impact: getImpact(monthlyCost),
    });
  }

  // 2. Cap Weekend Outflows (weekend)
  const satAmount = dayOfWeekPeaks.find((p) => p.dayName === 'Sat')?.amount || 0;
  const sunAmount = dayOfWeekPeaks.find((p) => p.dayName === 'Sun')?.amount || 0;
  const friAmount = dayOfWeekPeaks.find((p) => p.dayName === 'Fri')?.amount || 0;
  const weekendTotal = satAmount + sunAmount + friAmount;
  const totalWeekAmount = dayOfWeekPeaks.reduce((sum, p) => sum + p.amount, 0);

  if (totalWeekAmount > 0) {
    const weekendPct = Math.round((weekendTotal / totalWeekAmount) * 100);
    if (weekendPct >= config.weekendPctThreshold) {
      const potential = Math.round(weekendTotal * 0.2);
      recommendations.push({
        id: 'rec-weekend',
        type: 'weekend',
        title: 'Cap Weekend Outflows',
        description: `Your spending on weekends (Fri-Sun) accounts for ${weekendPct}% of your total outflows. Capping weekend card spend by 20% can save you around ₹${potential.toLocaleString('en-IN')} per cycle.`,
        potentialSavings: potential,
        impact: getImpact(potential),
      });
    }
  }

  // 3. Reduce Weekday Outflows (weekday)
  const sortedDays = [...dayOfWeekPeaks].sort((a, b) => b.amount - a.amount);
  const highestDay = sortedDays[0];
  if (highestDay && highestDay.amount > 0) {
    const potential = Math.round(highestDay.amount * 0.15);
    recommendations.push({
      id: 'rec-weekday',
      type: 'weekday',
      title: `Reduce ${highestDay.dayName} Outflows`,
      description: `Your card spending peaks on ${highestDay.dayName}s (totaling ₹${highestDay.amount.toLocaleString('en-IN')}). Cooking at home or shifting to free activities on ${highestDay.dayName}s can save ₹${potential.toLocaleString('en-IN')}.`,
      potentialSavings: potential,
      impact: getImpact(potential),
    });
  }

  // 4. Avoid Date Trap (date_trap)
  const weekendSkewedPeaks = dayOfMonthPeaks
    .filter((p) => p.amount > 0 && (p.weekendAmount || 0) / p.amount >= 0.7)
    .sort((a, b) => b.amount - a.amount);

  if (weekendSkewedPeaks.length > 0) {
    const topTrap = weekendSkewedPeaks[0];
    const biasPct = Math.round(((topTrap.weekendAmount || 0) / topTrap.amount) * 100);
    const potential = Math.round(topTrap.amount * 0.25);
    recommendations.push({
      id: 'rec-date-trap',
      type: 'date_trap',
      title: `Avoid Date Trap: Day ${topTrap.day}`,
      description: `Historically, spending on Day ${topTrap.day} is highly weekend-skewed (${biasPct}% spent on Fri-Sun). Avoid shopping when Day ${topTrap.day} falls on a weekend to save ₹${potential.toLocaleString('en-IN')}.`,
      potentialSavings: potential,
      impact: getImpact(potential),
    });
  }

  // 5. Category Splurge Control (category_cap)
  const categoryTotals: Record<string, number> = {};
  rangeDiscretionary.forEach((tx) => {
    const cat = tx.category || 'Other';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + getSignedAmount(tx);
  });

  const sortedCategories = Object.keys(categoryTotals)
    .map((cat) => ({ name: cat, amount: categoryTotals[cat] }))
    .sort((a, b) => b.amount - a.amount);

  sortedCategories.forEach((topCat, index) => {
    if (discretionarySpend > 0) {
      const catPct = Math.round((topCat.amount / discretionarySpend) * 100);
      if (catPct >= config.categoryPctThreshold && topCat.amount > 0) {
        const potential = Math.round(topCat.amount * 0.2);
        recommendations.push({
          id: `rec-category-${index}`,
          type: 'category_cap',
          title: `Cap Spend on ${topCat.name}`,
          description: `The "${topCat.name}" category consumes ${catPct}% of your discretionary spending (₹${topCat.amount.toLocaleString('en-IN')}). Setting a budget cap here can save ₹${potential.toLocaleString('en-IN')}.`,
          potentialSavings: potential,
          impact: getImpact(potential),
        });
      }
    }
  });

  // 6. Merchant Frequency Trap (merchant_frequency)
  const merchantCounts: Record<string, { count: number; total: number }> = {};
  rangeDiscretionary.forEach((tx) => {
    const m = tx.merchant || 'Other';
    if (!merchantCounts[m]) merchantCounts[m] = { count: 0, total: 0 };
    merchantCounts[m].count += 1;
    merchantCounts[m].total += getSignedAmount(tx);
  });

  const frequencyTraps = Object.keys(merchantCounts)
    .map((m) => ({ merchant: m, count: merchantCounts[m].count, total: merchantCounts[m].total }))
    .filter((item) => item.count >= config.merchantVisitsThreshold && item.total > 0)
    .sort((a, b) => b.count - a.count);

  frequencyTraps.slice(0, 3).forEach((topFreq, index) => {
    const potential = Math.round(topFreq.total * 0.3);
    recommendations.push({
      id: `rec-merchant-freq-${index}`,
      type: 'merchant_frequency',
      title: `Review ${topFreq.merchant} Visits`,
      description: `You made ${topFreq.count} transactions at ${topFreq.merchant} this cycle (spending ₹${topFreq.total.toLocaleString('en-IN')}). Spacing out visits can save ₹${potential.toLocaleString('en-IN')}.`,
      potentialSavings: potential,
      impact: getImpact(potential),
    });
  });

  // 7. Investment Surplus Routing (investment)
  const projectedSurplus = expectedSalary - totalFixedCharges - projectedCardOutlay;
  if (projectedSurplus >= 20000) {
    const potential = Math.round(projectedSurplus * 0.4);
    recommendations.push({
      id: 'rec-investment',
      type: 'investment',
      title: 'Route Surplus to Wealth Building',
      description: `You are projected to finish this cycle with a healthy salary surplus of ₹${projectedSurplus.toLocaleString('en-IN')}. Route ₹${potential.toLocaleString('en-IN')} (40%) to index funds or SIPs.`,
      potentialSavings: potential,
      impact: 'high',
    });
  }

  // 8. Run-Rate Variance Alert (run_rate_margin)
  const sustainableCap = Math.max(0, expectedSalary - totalFixedCharges);
  if (projectedCardOutlay > targetBudget || projectedCardOutlay > sustainableCap) {
    const overrun = projectedCardOutlay - Math.min(targetBudget, sustainableCap);
    recommendations.push({
      id: 'rec-run-rate-margin',
      type: 'run_rate_margin',
      title: 'Cycle Overspend Warning',
      description: `At your current velocity, you are projected to overrun your safe limits by ₹${overrun.toLocaleString('en-IN')}. Review immediate daily card card-spend controls.`,
      potentialSavings: 0,
      impact: 'critical',
    });
  }

  // 9. 50/30/20 Rule Balance (budget_split)
  if (totalFixedCharges + targetBudget > expectedSalary) {
    const deficit = totalFixedCharges + targetBudget - expectedSalary;
    recommendations.push({
      id: 'rec-budget-split',
      type: 'budget_split',
      title: 'Allocation Exceeds Salary Flow',
      description: `Your active fixed charges (needs) plus card cap (wants) exceed expected salary by ₹${deficit.toLocaleString('en-IN')}. Capping card spend goals is necessary to save.`,
      potentialSavings: 0,
      impact: 'critical',
    });
  }

  // 10. Unused Budget Calibration (budget_drift)
  if (discretionarySpend > 0 && projectedCardOutlay <= targetBudget * 0.5) {
    const drift = targetBudget - projectedCardOutlay;
    recommendations.push({
      id: 'rec-budget-drift',
      type: 'budget_drift',
      title: 'Calibrate Card Spend Goal',
      description: `Your projected card spent is 50%+ below your card cap. Lock in a higher surplus by sliding down your cap to match your actual spent.`,
      potentialSavings: drift,
      impact: getImpact(drift),
    });
  }

  // 11. Subscription Creep warning (subscription_creep)
  const smallBills = recurringBills.filter((bill) => {
    const cost = bill.averageAmount * (30 / bill.frequencyDays);
    return cost < 1500;
  });
  const smallBillsTotal = smallBills.reduce((sum, bill) => sum + bill.averageAmount * (30 / bill.frequencyDays), 0);
  if (smallBills.length >= 3 && smallBillsTotal >= expectedSalary * 0.15) {
    const potential = Math.round(smallBillsTotal * 0.3);
    recommendations.push({
      id: 'rec-subscription-creep',
      type: 'subscription_creep',
      title: 'Subscription Creep Detected',
      description: `You have ${smallBills.length} small subscriptions aggregating to ₹${Math.round(smallBillsTotal).toLocaleString('en-IN')}/month. Clean up unused trials to save ₹${potential.toLocaleString('en-IN')}.`,
      potentialSavings: potential,
      impact: getImpact(potential),
    });
  }

  // 12. Fixed Cost Burden Warning (fixed_burden)
  if (expectedSalary > 0 && totalFixedCharges >= expectedSalary * (config.fixedBurdenPctThreshold / 100)) {
    const pct = Math.round((totalFixedCharges / expectedSalary) * 100);
    recommendations.push({
      id: 'rec-fixed-burden',
      type: 'fixed_burden',
      title: 'High Fixed Cost Commitments',
      description: `Your active template templates (loans, rent) absorb ${pct}% of expected salary. Avoid locking in new recurring commitments to keep cash fluid.`,
      potentialSavings: 0,
      impact: 'critical',
    });
  }

  // 13. Single Large Outflow Shock (large_expense)
  const largeExpenses = rangeDiscretionary
    .filter((tx) => getSignedAmount(tx) >= expectedSalary * (config.largeExpensePctThreshold / 100))
    .sort((a, b) => getSignedAmount(b) - getSignedAmount(a));

  if (largeExpenses.length > 0) {
    const topLarge = largeExpenses[0];
    const amount = getSignedAmount(topLarge);
    recommendations.push({
      id: 'rec-large-expense',
      type: 'large_expense',
      title: `Analyze Large Expense: ${topLarge.merchant}`,
      description: `A single purchase of ₹${amount.toLocaleString('en-IN')} at ${topLarge.merchant} consumed a large chunk of your cycle card-spend flow. Verify if this was pre-budgeted.`,
      potentialSavings: 0,
      impact: 'high',
    });
  }

  return recommendations;
};

/**
 * Normalizes recurring bills (weekly, biweekly, monthly) to a 30-day monthly burden sum.
 */
export const calculateRecurringMonthlyBurden = (
  recurringBills: RecurringBillPrediction[]
): number => {
  if (!Array.isArray(recurringBills)) return 0;
  return recurringBills.reduce((sum, bill) => {
    const freqDays = bill.frequencyDays > 0 ? bill.frequencyDays : 30;
    return sum + (bill.averageAmount * (30 / freqDays));
  }, 0);
};

/**
 * Computes the percentage of expected monthly salary consumed by recurring bills burden.
 */
export const calculateBurdenSalaryPercentage = (
  monthlyBurdenTotal: number,
  expectedSalary: number
): number => {
  if (!expectedSalary || expectedSalary <= 0) return 0;
  return (monthlyBurdenTotal / expectedSalary) * 100;
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

/**
 * Computes sum total of potential savings across recommendations.
 */
export const calculateTotalPotentialSavings = (
  recommendations: SavingsRecommendation[] = []
): number => {
  if (!Array.isArray(recommendations)) return 0;
  return recommendations.reduce((sum, r) => sum + (Number(r.potentialSavings) || 0), 0);
};
