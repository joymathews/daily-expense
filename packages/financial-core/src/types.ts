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

export type CategorySpendMap = Record<string, Record<string, number>>;

export interface CategorySpendItem {
  category: string;
  currency: string;
  amount: number;
}

export interface DailySpendSeriesResult {
  spends: Array<{ date: string; amount: number | null }>;
  total: number;
}

export interface PeakAveragesResult {
  totalDOMAmount: number;
  avgDOMAmount: number;
  totalDOWAmount: number;
  avgDOWAmount: number;
}
