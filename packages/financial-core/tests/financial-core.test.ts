import { describe, it, expect } from 'vitest';
import {
  getDaysDiff,
  getActiveCycleRange,
  getExpectedCycleEnd,
  normalizeCategory,
  calculateDiscretionarySpend,
  calculateDaySpend,
  calculateRunRateForecast,
  calculateDailyAllowance,
  calculateNetSavings,
  calculateDayOfMonthPeaks,
  calculateDayOfWeekPeaks,
  detectRecurringBills,
  formatCurrency,
  formatCycleDisplayDate,
  FinancialTransaction,
  FixedCharge,
  filterActiveFixedCharges,
  calculateTotalFixedCharges,
  calculateCategorySpend,
  getTopSpendingCategories,
  calculateCurrencyTotals,
  calculateCycleSpendTotal,
  buildDailySpendMap,
  buildDailyTransactionsMap,
  calculateDailySpendSeries,
  calculateTargetBudget,
  calculateEffectiveBudgetLimit,
  calculateBudgetPercentConsumed,
  calculateAverageDailySpend,
  calculateRecurringMonthlyBurden,
  calculateBurdenSalaryPercentage,
  calculatePeakAverages,
  calculatePeakPercentDeviation,
  getPeakPercentDeviationText,
  orderDOMPeaksByBillingCycle,
  calculateTotalPotentialSavings,
} from '../src';

describe('Financial Core Engine Unit Tests', () => {
  describe('[NFR-MOB-3] Cycle & Date Calculations', () => {
    it('calculates days difference inclusive of endpoints', () => {
      expect(getDaysDiff('2026-08-01', '2026-08-10')).toBe(10);
      expect(getDaysDiff('2026-08-10', '2026-08-10')).toBe(1);
      expect(getDaysDiff('2026-08-10', '2026-08-01')).toBe(0);
    });

    it('generates accurate active cycle range for start day', () => {
      const ref = new Date(2026, 7, 20); // Aug 20, 2026
      const range = getActiveCycleRange(17, ref);
      expect(range.start).toBe('2026-08-17');
      expect(range.end).toBe('2026-09-18');
    });

    it('calculates expected cycle end date for cycle start', () => {
      expect(getExpectedCycleEnd('2026-08-17', 17)).toBe('2026-09-18');
      expect(getExpectedCycleEnd('2026-12-17', 17)).toBe('2027-01-18');
    });
  });

  describe('[NFR-MOB-3] Transaction Aggregation & Normalization', () => {
    it('normalizes standard and custom categories', () => {
      expect(normalizeCategory('dining')).toBe('Food & Dining');
      expect(normalizeCategory('shopping')).toBe('Shopping');
      expect(normalizeCategory('custom gym fee')).toBe('Custom Gym Fee');
      expect(normalizeCategory('')).toBe('Other');
    });

    it('calculates discretionary spend by excluding transfers and fixed charges while offsetting refunds', () => {
      const txs: FinancialTransaction[] = [
        { amount: 1000, transactionDate: '2026-08-18', transactionType: 'expense' },
        { amount: 500, transactionDate: '2026-08-19', transactionType: 'refund' },
        { amount: 20000, transactionDate: '2026-08-20', transactionType: 'transfer' },
        { amount: 30000, transactionDate: '2026-08-20', transactionType: 'fixed' },
        { amount: 2500, transactionDate: '2026-08-22', transactionType: 'expense' },
      ];

      const spend = calculateDiscretionarySpend(txs, '2026-08-17', '2026-09-16');
      // 1000 - 500 + 2500 = 3000 (transfers and fixed excluded)
      expect(spend).toBe(3000);
    });

    it('calculates today specific day spend', () => {
      const txs: FinancialTransaction[] = [
        { amount: 400, transactionDate: '2026-08-30', transactionType: 'expense' },
        { amount: 150, transactionDate: '2026-08-30', transactionType: 'expense' },
        { amount: 50, transactionDate: '2026-08-30', transactionType: 'refund' },
        { amount: 999, transactionDate: '2026-08-29', transactionType: 'expense' },
      ];
      expect(calculateDaySpend(txs, '2026-08-30')).toBe(500);
    });
  });

  describe('[FUNC-MOB-1] Forecast & Real-Time Daily Allowance Engine', () => {
    it('computes run-rate forecast, velocity, and projected end spend', () => {
      const forecast = calculateRunRateForecast(
        30000,
        100000,
        50, // 50k target cap
        { start: '2026-08-01', end: '2026-08-30' }, // 30 days total
        '2026-08-15', // 15 days elapsed, 15 days remaining
        10000 // 10k fixed charges -> sustainable cap 90k
      );

      expect(forecast.targetBudget).toBe(50000);
      expect(forecast.elapsedDays).toBe(15);
      expect(forecast.remainingDays).toBe(15);
      expect(forecast.dailyVelocity).toBe(2000); // 30k / 15d
      expect(forecast.projectedSpend).toBe(60000); // 2k * 30d
      expect(forecast.isExceeding).toBe(true);
      expect(forecast.recommendedDailyRate).toBeCloseTo(1333.33, 1); // 20k left / 15d
    });

    it('calculates real-time daily safe allowance for today and future days', () => {
      const allowance = calculateDailyAllowance(
        32000, // total spend so far in cycle (including today's 2000)
        2000,  // spent today
        50000, // 50k budget cap
        { start: '2026-08-01', end: '2026-08-30' }, // 30 days total
        '2026-08-21' // Day 21 (20 days before today, 10 days remaining including today)
      );

      // Spend before today = 30,000. Remaining budget at start of today = 20,000.
      // Days remaining including today = 30 - 20 = 10 days.
      // Daily safe allowance = 20,000 / 10 = 2,000.
      expect(allowance.dailySafeAllowance).toBe(2000);
      expect(allowance.spentToday).toBe(2000);
      expect(allowance.availableToSpendToday).toBe(0);
      expect(allowance.isTodayOverspent).toBe(false);

      // Future remaining days = 9 days. Remaining budget = 50,000 - 32,000 = 18,000.
      // Future daily rate = 18,000 / 9 = 2,000 / day.
      expect(allowance.recommendedFutureDailyRate).toBe(2000);
    });

    it('handles overspent today gracefully by computing overspent amount and reduced future rate', () => {
      const allowance = calculateDailyAllowance(
        35000, // total spend (including today's 5000)
        5000,  // spent today
        50000, // 50k budget cap
        { start: '2026-08-01', end: '2026-08-30' },
        '2026-08-21' // 10 days remaining including today
      );

      // Spend before today = 30,000. Remaining budget at start of today = 20,000.
      // Daily allowance for today was 2,000.
      expect(allowance.dailySafeAllowance).toBe(2000);
      expect(allowance.spentToday).toBe(5000);
      expect(allowance.isTodayOverspent).toBe(true);
      expect(allowance.overspentTodayAmount).toBe(3000);
      expect(allowance.availableToSpendToday).toBe(0);

      // Future remaining budget = 50k - 35k = 15k across 9 remaining days = 1666.67
      expect(allowance.recommendedFutureDailyRate).toBeCloseTo(1666.67, 1);
    });
  });

  describe('[NFR-MOB-3] Periodicity, Patterns & Formatters', () => {
    it('detects day of month and day of week peak aggregations', () => {
      const txs: FinancialTransaction[] = [
        { amount: 500, transactionDate: '2026-08-05', transactionType: 'expense' },
        { amount: 300, transactionDate: '2026-08-05', transactionType: 'expense' },
      ];
      const domPeaks = calculateDayOfMonthPeaks(txs);
      expect(domPeaks.find(p => p.day === 5)?.amount).toBe(800);

      const dowPeaks = calculateDayOfWeekPeaks(txs);
      expect(dowPeaks.length).toBe(7);
    });

    it('detects recurring bill patterns', () => {
      const txs: FinancialTransaction[] = [
        { amount: 500, transactionDate: '2026-06-05', merchant: 'Netflix', transactionType: 'expense' },
        { amount: 500, transactionDate: '2026-07-05', merchant: 'Netflix', transactionType: 'expense' },
        { amount: 500, transactionDate: '2026-08-05', merchant: 'Netflix', transactionType: 'expense' },
      ];
      const recurring = detectRecurringBills(txs, '2026-08-30');
      expect(recurring.length).toBe(1);
      expect(recurring[0].merchant).toBe('Netflix');
      expect(recurring[0].averageAmount).toBe(500);
    });

    it('formats currencies and dates correctly', () => {
      expect(formatCurrency(1500, 'INR')).toBe('₹1,500.00');
      expect(formatCurrency(25.5, 'USD')).toBe('USD 25.50');
      expect(formatCycleDisplayDate('2026-08-17')).toBe("17 Aug '26");
    });

    it('calculates target and projected net savings surplus correctly', () => {
      const { netSavingsTarget, netSavingsProjected } = calculateNetSavings(100000, 20000, 50000, 45000);
      expect(netSavingsTarget).toBe(30000); // 100000 - 20000 - 50000
      expect(netSavingsProjected).toBe(35000); // 100000 - 20000 - 45000
    });
  });

  describe('[FUNC-ANALYSIS-21] [NFR-ARCH-3] Consolidated Domain & Metric Calculations', () => {
    it('filters and sums active fixed charges within a cycle range', () => {
      const fcs: FixedCharge[] = [
        { id: '1', name: 'Rent', amount: 25000, currency: 'INR', startDate: '2026-01-01', endDate: '2026-12-31' },
        { id: '2', name: 'Loan Past', amount: 5000, currency: 'INR', startDate: '2025-01-01', endDate: '2026-07-31' },
        { id: '3', name: 'Future Policy', amount: 10000, currency: 'INR', startDate: '2026-10-01', endDate: '2027-10-01' },
      ];
      const cycleRange = { start: '2026-08-17', end: '2026-09-16' };

      const active = filterActiveFixedCharges(fcs, cycleRange);
      expect(active.length).toBe(1);
      expect(active[0].name).toBe('Rent');

      const total = calculateTotalFixedCharges(fcs, cycleRange);
      expect(total).toBe(25000);

      // Edge cases
      expect(filterActiveFixedCharges(null, cycleRange)).toEqual([]);
      expect(calculateTotalFixedCharges(undefined, cycleRange)).toBe(0);
    });

    it('aggregates category spends and extracts top spending categories', () => {
      const txs: FinancialTransaction[] = [
        { amount: 1200, category: 'Groceries', currency: 'INR', transactionDate: '2026-08-18', transactionType: 'expense' },
        { amount: 300, category: 'Groceries', currency: 'INR', transactionDate: '2026-08-19', transactionType: 'refund' },
        { amount: 5000, category: 'Travel', currency: 'INR', transactionDate: '2026-08-20', transactionType: 'expense' },
        { amount: 2000, category: 'Utilities', currency: 'USD', transactionDate: '2026-08-21', transactionType: 'expense' },
        { amount: 50000, category: 'Transfer', currency: 'INR', transactionDate: '2026-08-22', transactionType: 'transfer' },
        { amount: 15000, category: 'Rent', currency: 'INR', transactionDate: '2026-08-22', transactionType: 'fixed' },
      ];

      const catMap = calculateCategorySpend(txs);
      expect(catMap['Groceries']['INR']).toBe(900); // 1200 - 300
      expect(catMap['Travel']['INR']).toBe(5000);
      expect(catMap['Utilities']['USD']).toBe(2000);
      expect(catMap['Transfer']).toBeUndefined();
      expect(catMap['Rent']).toBeUndefined();

      const top = getTopSpendingCategories(catMap, 2);
      expect(top.length).toBe(2);
      expect(top[0].category).toBe('Travel');
      expect(top[0].amount).toBe(5000);
      expect(top[1].category).toBe('Utilities');
      expect(top[1].amount).toBe(2000);
    });

    it('calculates currency totals and net cycle spend total', () => {
      const txs: FinancialTransaction[] = [
        { amount: 1500, currency: 'INR', transactionDate: '2026-08-18', transactionType: 'expense' },
        { amount: 200, currency: 'INR', transactionDate: '2026-08-19', transactionType: 'refund' },
        { amount: 50, currency: 'usd', transactionDate: '2026-08-20', transactionType: 'expense' },
        { amount: 10000, currency: 'INR', transactionDate: '2026-08-21', transactionType: 'transfer' },
      ];

      const currencyTotals = calculateCurrencyTotals(txs);
      expect(currencyTotals['INR']).toBe(1300); // 1500 - 200 (transfer excluded)
      expect(currencyTotals['USD']).toBe(50);

      const cycleTotal = calculateCycleSpendTotal(txs);
      expect(cycleTotal).toBe(1350); // 1500 - 200 + 50
    });

    it('builds daily spend maps and transaction maps', () => {
      const txs: FinancialTransaction[] = [
        { amount: 500, transactionDate: '2026-08-18', merchant: 'Swiggy', transactionType: 'expense' },
        { amount: 200, transactionDate: '2026-08-18', merchant: 'Uber', transactionType: 'expense' },
        { amount: 100, transactionDate: '2026-08-19', merchant: 'Zomato', transactionType: 'expense' },
      ];

      const spendMap = buildDailySpendMap(txs);
      expect(spendMap['2026-08-18']).toBe(700);
      expect(spendMap['2026-08-19']).toBe(100);

      const txMap = buildDailyTransactionsMap(txs);
      expect(txMap['2026-08-18'].length).toBe(2);
      expect(txMap['2026-08-19'].length).toBe(1);
    });

    it('calculates daily spend series (discrete and cumulative) with payment filters', () => {
      const txs: FinancialTransaction[] = [
        { amount: 1000, transactionDate: '2026-08-01', paymentMethod: 'HDFC CC', transactionType: 'expense' },
        { amount: 500, transactionDate: '2026-08-02', paymentMethod: 'UPI', transactionType: 'expense' },
        { amount: 1500, transactionDate: '2026-08-03', paymentMethod: 'HDFC CC', transactionType: 'expense' },
      ];
      const dates = ['2026-08-01', '2026-08-02', '2026-08-03'];

      const discrete = calculateDailySpendSeries(txs, dates, { selectedPaymentMethods: ['HDFC CC'] });
      expect(discrete.spends[0].amount).toBe(1000);
      expect(discrete.spends[1].amount).toBe(0); // UPI filtered out
      expect(discrete.spends[2].amount).toBe(1500);
      expect(discrete.total).toBe(2500);

      const cumulative = calculateDailySpendSeries(txs, dates, { isCumulative: true });
      expect(cumulative.spends[0].amount).toBe(1000);
      expect(cumulative.spends[1].amount).toBe(1500); // 1000 + 500
      expect(cumulative.spends[2].amount).toBe(3000); // 1500 + 1500
      expect(cumulative.total).toBe(3000);

      const emptyPMs = calculateDailySpendSeries(txs, dates, { selectedPaymentMethods: [] });
      expect(emptyPMs.total).toBe(0);
    });

    it('calculates target budget, effective limit, percent consumed, and average daily spend', () => {
      expect(calculateTargetBudget(100000, 50)).toBe(50000);
      expect(calculateTargetBudget(120000, 40)).toBe(48000);

      expect(calculateEffectiveBudgetLimit(50000, 70000)).toBe(50000);
      expect(calculateEffectiveBudgetLimit(50000, 30000)).toBe(30000);
      expect(calculateEffectiveBudgetLimit(50000, undefined)).toBe(50000);

      expect(calculateBudgetPercentConsumed(25000, 50000)).toBe(50);
      expect(calculateBudgetPercentConsumed(60000, 50000)).toBe(100);
      expect(calculateBudgetPercentConsumed(0, 50000)).toBe(0);
      expect(calculateBudgetPercentConsumed(1000, 0)).toBe(0);

      expect(calculateAverageDailySpend(15000, 10)).toBe(1500);
      expect(calculateAverageDailySpend(15000, 0)).toBe(0);
    });

    it('calculates recurring monthly burden and burden percentage of salary', () => {
      const bills: RecurringBillPrediction[] = [
        { merchant: 'Netflix', averageAmount: 649, frequencyDays: 30, lastDate: '2026-08-01', predictedNextDate: '2026-09-01', allIntervals: [], allDates: [] },
        { merchant: 'Milk Basket', averageAmount: 700, frequencyDays: 7, lastDate: '2026-08-01', predictedNextDate: '2026-08-08', allIntervals: [], allDates: [] },
      ];

      // 649 * (30/30) + 700 * (30/7) = 649 + 3000 = 3649
      const burden = calculateRecurringMonthlyBurden(bills);
      expect(burden).toBe(3649);

      const burdenPct = calculateBurdenSalaryPercentage(burden, 100000);
      expect(burdenPct).toBeCloseTo(3.649, 2);
    });

    it('calculates peak averages, percentage deviations, and cycle order', () => {
      const domPeaks = [
        { day: 5, amount: 3100, weekendAmount: 0 },
        { day: 20, amount: 6200, weekendAmount: 0 },
      ];
      const dowPeaks = [
        { dayName: 'Mon', amount: 700 },
        { dayName: 'Sat', amount: 1400 },
      ];

      const avgs = calculatePeakAverages(domPeaks, dowPeaks);
      expect(avgs.totalDOMAmount).toBe(9300);
      expect(avgs.avgDOMAmount).toBe(300); // 9300 / 31
      expect(avgs.totalDOWAmount).toBe(2100);
      expect(avgs.avgDOWAmount).toBe(300); // 2100 / 7

      expect(calculatePeakPercentDeviation(450, 300)).toBe(50); // +50%
      expect(calculatePeakPercentDeviation(150, 300)).toBe(-50); // -50%

      expect(getPeakPercentDeviationText(450, 300)).toBe(' (+50% vs Avg)');
      expect(getPeakPercentDeviationText(150, 300)).toBe(' (-50% vs Avg)');
      expect(getPeakPercentDeviationText(300, 300)).toBe(' (Avg)');

      const ordered = orderDOMPeaksByBillingCycle(domPeaks, 17);
      expect(ordered[0].day).toBe(20);
      expect(ordered[1].day).toBe(5);
    });

    it('calculates total potential savings across recommendations', () => {
      const recs: any[] = [
        { id: '1', potentialSavings: 1500 },
        { id: '2', potentialSavings: 3000 },
        { id: '3', potentialSavings: 0 },
      ];
      expect(calculateTotalPotentialSavings(recs)).toBe(4500);
      expect(calculateTotalPotentialSavings([])).toBe(0);
    });
  });
});
