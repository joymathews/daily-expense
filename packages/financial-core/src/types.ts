export type TransactionType = 'expense' | 'refund' | 'transfer' | 'fixed';

export interface HasAmountAndTransactionType {
  amount: number;
  transactionType?: string | null;
}

export interface FinancialTransaction {
  id?: string;
  amount: number;
  currency?: string;
  transactionDate: string; // YYYY-MM-DD
  category?: string;
  paymentMethod?: string;
  transactionType?: TransactionType;
  merchant?: string;
  merchantRaw?: string;
  notes?: string;
  createdAt?: string;
  sourceReceivedAt?: string;
  sourceType?: string;
  sourceTitle?: string;
  sourceSender?: string;
  bronzeInputId?: string;
  parentTransactionId?: string;
}

export interface UserCycle {
  id: string;
  cycleName: string;
  startType: 'default' | 'transaction' | 'date';
  startTransactionId?: string;
  startDate: string; // YYYY-MM-DD
  startTimestamp: string; // ISO string
  endDate: string | null; // YYYY-MM-DD or null
  endTimestamp: string | null; // ISO string or null
  totalDays: number | null;
  isCurrent: boolean;
}

export interface CycleRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  startTimestamp?: string;
  endTimestamp?: string;
}

export interface FixedCharge {
  id: string;
  name: string;
  amount: number;
  currency: string;
  category?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  paymentMethod?: string;
}

export interface RunRateForecastResult {
  targetBudget: number;
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  dailyVelocity: number;
  projectedSpend: number;
  projectedTotal?: number;
  isExceeding: boolean;
  exhaustionDate: string | null;
  recommendedDailyRate: number;
  sustainableCap: number;
}

export interface DailyBurnAllowanceResult {
  dailySafeAllowance: number;
  spentToday: number;
  availableToSpendToday: number;
  recommendedFutureDailyRate: number;
  isTodayOverspent: boolean;
  overspentTodayAmount: number;
}

export interface DayPeakPoint {
  day: number;
  amount: number;
  count?: number;
  weekendAmount: number;
}

export interface DayOfWeekPeakPoint {
  dayName: string;
  dayIndex?: number;
  amount: number;
  count?: number;
}

export type DetectionFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

export interface RecurringBillPrediction {
  merchant: string;
  averageAmount: number;
  frequencyDays: number;
  lastDate: string;
  predictedNextDate: string;
  historyCount?: number;
  allIntervals: number[];
  allDates: string[];
  confidence?: number;
  occurrences?: number;
}

export interface SavingsRecommendation {
  id: string;
  type:
    | 'weekend'
    | 'recurring'
    | 'weekday'
    | 'date_trap'
    | 'run_rate_margin'
    | 'category_cap'
    | 'budget_split'
    | 'budget_drift'
    | 'subscription_creep'
    | 'merchant_frequency'
    | 'investment'
    | 'fixed_burden'
    | 'large_expense';
  title: string;
  description: string;
  potentialSavings: number;
  impact: 'high' | 'medium' | 'low' | 'critical';
}

export interface InsightsConfig {
  weekendPctThreshold: number;
  categoryPctThreshold: number;
  merchantVisitsThreshold: number;
  largeExpensePctThreshold: number;
  fixedBurdenPctThreshold: number;
}

export interface DailyTrendPoint {
  date: string;
  amount: number;
}

export interface SalaryAllocationResult {
  mutualFundSpend: number;
  consumptionSpend: number;
  totalSaved: number;
  mutualFundPercent: number;
  consumptionPercent: number;
  unspentPercent: number;
  allocationTransactions: FinancialTransaction[];
  bankDebitTotal: number;
}
