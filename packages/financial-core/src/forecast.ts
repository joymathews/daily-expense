import { RunRateForecastResult, DailyBurnAllowanceResult, CycleRange } from './types';
import { getDaysDiff } from './cycles';

/**
 * Projects end of cycle expenditures and forecasts budget exhaustion dates.
 */
export const calculateRunRateForecast = (
  discretionarySpend: number,
  expectedSalary: number,
  targetBudgetPercent: number,
  cycleRange: CycleRange,
  todayStr: string,
  totalFixedCharges?: number,
  spentToday?: number
): RunRateForecastResult => {
  const targetBudget = Math.round(expectedSalary * (targetBudgetPercent / 100));
  const sustainableCap = Math.max(0, expectedSalary - (totalFixedCharges || 0));
  const totalDays = getDaysDiff(cycleRange.start, cycleRange.end) || 30;
  
  // Bound todayStr to cycle range limits
  let adjustedToday = todayStr;
  if (todayStr < cycleRange.start) adjustedToday = cycleRange.start;
  if (todayStr > cycleRange.end) adjustedToday = cycleRange.end;
  
  // Elapsed completed days strictly before today (0 on Day 1)
  const elapsedDays = Math.max(0, getDaysDiff(cycleRange.start, adjustedToday) - 1);
  // Remaining future days after today (0 on the final day)
  const remainingDays = Math.max(0, totalDays - elapsedDays - 1);
  
  // Daily velocity: past spend / completed days (or today's initial spend on Day 1)
  const pastSpend = Math.max(0, discretionarySpend - (spentToday || 0));
  const dailyVelocity = elapsedDays > 0
    ? pastSpend / elapsedDays
    : (spentToday !== undefined ? spentToday : discretionarySpend);

  // Projected end-of-cycle spend: total spend to date + (daily velocity * future remaining days)
  const projectedSpend = Math.round(discretionarySpend + (dailyVelocity * remainingDays));
  
  // Exceeding if actual projected spend exceeds self-imposed cap OR sustainable cap (to prevent deficit)
  const isExceeding = projectedSpend > targetBudget || projectedSpend > sustainableCap;
  
  let exhaustionDate: string | null = null;
  // Exhaustion date is based on the first limit we hit (targetBudget or sustainableCap)
  const effectiveLimit = Math.min(targetBudget, sustainableCap);
  if (projectedSpend > effectiveLimit && dailyVelocity > 0) {
    const daysUntilExhaustion = effectiveLimit / dailyVelocity;
    const start = new Date(cycleRange.start);
    start.setDate(start.getDate() + Math.floor(daysUntilExhaustion));
    
    const year = start.getFullYear();
    const month = String(start.getMonth() + 1).padStart(2, '0');
    const day = String(start.getDate()).padStart(2, '0');
    exhaustionDate = `${year}-${month}-${day}`;
  }
  
  const remainingBudget = Math.max(0, effectiveLimit - discretionarySpend);
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
    recommendedDailyRate,
    sustainableCap,
  };
};

/**
 * Calculates the real-time daily safe allowance for today and dynamic recommendations.
 * 
 * @param totalSpendToDate Total discretionary spend in the cycle up to and including today.
 * @param spentToday Total discretionary spend specifically logged today.
 * @param effectiveLimit Budget cap or sustainable limit for the cycle.
 * @param cycleRange Current cycle start and end dates.
 * @param todayStr Today's date (YYYY-MM-DD).
 */
export const calculateDailyAllowance = (
  totalSpendToDate: number,
  spentToday: number,
  effectiveLimit: number,
  cycleRange: CycleRange,
  todayStr: string
): DailyBurnAllowanceResult => {
  const totalDays = getDaysDiff(cycleRange.start, cycleRange.end) || 30;
  
  let adjustedToday = todayStr;
  if (todayStr < cycleRange.start) adjustedToday = cycleRange.start;
  if (todayStr > cycleRange.end) adjustedToday = cycleRange.end;

  const elapsedDaysBeforeToday = Math.max(0, getDaysDiff(cycleRange.start, adjustedToday) - 1);
  const remainingDaysIncludingToday = Math.max(1, totalDays - elapsedDaysBeforeToday);
  const spendBeforeToday = Math.max(0, totalSpendToDate - spentToday);

  // Daily allowance allocation at start of today
  const budgetRemainingAtStartOfDay = Math.max(0, effectiveLimit - spendBeforeToday);
  const dailySafeAllowance = remainingDaysIncludingToday > 0 
    ? budgetRemainingAtStartOfDay / remainingDaysIncludingToday 
    : 0;

  // Available remaining today
  const availableToSpendToday = Math.max(0, dailySafeAllowance - spentToday);
  const isTodayOverspent = spentToday > dailySafeAllowance;
  const overspentTodayAmount = isTodayOverspent ? spentToday - dailySafeAllowance : 0;

  // Recommended future daily rate for subsequent remaining days (N-1)
  const remainingDaysAfterToday = Math.max(0, remainingDaysIncludingToday - 1);
  const budgetRemainingAfterToday = Math.max(0, effectiveLimit - totalSpendToDate);
  const recommendedFutureDailyRate = remainingDaysAfterToday > 0 
    ? budgetRemainingAfterToday / remainingDaysAfterToday 
    : 0;

  return {
    dailySafeAllowance: Math.round(dailySafeAllowance * 100) / 100,
    spentToday: Math.round(spentToday * 100) / 100,
    availableToSpendToday: Math.round(availableToSpendToday * 100) / 100,
    recommendedFutureDailyRate: Math.round(recommendedFutureDailyRate * 100) / 100,
    isTodayOverspent,
    overspentTodayAmount: Math.round(overspentTodayAmount * 100) / 100,
  };
};

/**
 * Calculates projected salary savings based on current velocity and target goal cap.
 * 
 * @param expectedSalary User's expected monthly salary.
 * @param totalFixedCharges Sum of recurring fixed commitments (Rent, EMIs, etc.).
 * @param targetBudget User's target discretionary goal cap.
 * @param projectedSpend Forecasted total discretionary spend at end of cycle.
 */
export const calculateNetSavings = (
  expectedSalary: number,
  totalFixedCharges: number,
  targetBudget: number,
  projectedSpend: number
): { netSavingsTarget: number; netSavingsProjected: number } => {
  const netSavingsTarget = (expectedSalary || 0) - (totalFixedCharges || 0) - (targetBudget || 0);
  const netSavingsProjected = (expectedSalary || 0) - (totalFixedCharges || 0) - (projectedSpend || 0);
  return { netSavingsTarget, netSavingsProjected };
};

/**
 * Calculates target budget based on monthly expected salary and target percent.
 */
export const calculateTargetBudget = (expectedSalary: number, targetBudgetPercent: number): number => {
  return Math.round((Number(expectedSalary) || 0) * ((Number(targetBudgetPercent) || 0) / 100));
};

/**
 * Derives the effective spending budget limit given target budget and sustainable cap.
 */
export const calculateEffectiveBudgetLimit = (targetBudget: number, sustainableCap?: number): number => {
  if (sustainableCap === undefined || isNaN(sustainableCap)) return targetBudget;
  return Math.min(targetBudget, sustainableCap);
};

/**
 * Computes percentage of budget limit consumed (0 to 100%).
 */
export const calculateBudgetPercentConsumed = (discretionarySpent: number, effectiveLimit: number): number => {
  if (effectiveLimit <= 0) return 0;
  return Math.min(100, Math.round((Math.max(0, discretionarySpent) / effectiveLimit) * 100));
};

/**
 * Calculates the average daily spend over a period.
 */
export const calculateAverageDailySpend = (totalSpend: number, dayCount: number): number => {
  if (!dayCount || dayCount <= 0) return 0;
  return totalSpend / dayCount;
};

