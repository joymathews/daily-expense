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
  FinancialTransaction
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
});
