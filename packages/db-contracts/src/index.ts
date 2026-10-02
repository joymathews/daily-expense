export interface RawInput {
  id: string; // unique natural ID (e.g. Gmail Message ID or PDF hash)
  userId: string;
  sourceType: string; // e.g. 'email', 'pdf', 'manual'
  sender: string; // e.g. email sender or uploader
  title: string; // e.g. email subject or file name
  snippet: string;
  rawBody: string;
  rawPayload: string; // JSON string payload metadata
  receivedAt: string; // ISO UTC string
  hasTransaction?: boolean; // classification cache
  status?: 'unprocessed' | 'processed' | 'rejected';
  ingestedAt?: string; // ISO UTC string
}

export const STANDARD_CATEGORIES = [
  'Groceries',
  'Cabs & Transport',
  'Travel',
  'Utilities',
  'Internet & Telecom',
  'Entertainment Subscriptions',
  'Cloud & Software Services',
  'Shopping',
  'Restaurant & Dining',
  'Online Food Order',
  'Medical & Healthcare',
  'Other'
];

export function normalizeCategory(category: string | undefined | null): string {
  if (!category) return 'Other';
  const trimmed = category.trim();
  if (!trimmed) return 'Other';

  const matchedStandard = STANDARD_CATEGORIES.find(
    c => c.toLowerCase() === trimmed.toLowerCase()
  );
  if (matchedStandard) {
    return matchedStandard;
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'grocery' || lower === 'grocery shopping') return 'Groceries';
  if (lower === 'cab' || lower === 'cabs' || lower === 'taxi' || lower === 'transport') return 'Cabs & Transport';
  if (lower === 'travel') return 'Travel';
  if (
    lower === 'utility' ||
    lower === 'utility bill' ||
    lower === 'gas' ||
    lower === 'electricity' ||
    lower === 'water' ||
    lower === 'maintenance' ||
    lower === 'maintenance charge' ||
    lower === 'maintenance charges'
  ) {
    return 'Utilities';
  }
  if (lower === 'internet' || lower === 'telecom' || lower === 'wifi' || lower === 'recharge') {
    return 'Internet & Telecom';
  }
  if (
    lower === 'subscription' ||
    lower === 'netflix' ||
    lower === 'spotify' ||
    lower === 'prime' ||
    lower === 'youtube'
  ) {
    return 'Entertainment Subscriptions';
  }
  if (
    lower === 'aws' ||
    lower === 'azure' ||
    lower === 'cloud' ||
    lower === 'software' ||
    lower === 'saas' ||
    lower === 'medium'
  ) {
    return 'Cloud & Software Services';
  }
  if (lower === 'shop' || lower === 'retail') return 'Shopping';
  if (lower === 'dining' || lower === 'restaurant' || lower === 'cafe' || lower === 'food') {
    return 'Restaurant & Dining';
  }
  if (lower === 'zomato' || lower === 'swiggy' || lower === 'food delivery' || lower === 'online food') {
    return 'Online Food Order';
  }
  if (lower === 'medical' || lower === 'healthcare' || lower === 'pharmacy' || lower === 'medicine') {
    return 'Medical & Healthcare';
  }

  return trimmed
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export class PaymentStandardizationService {
  static standardize(
    rawPaymentMethod: string | undefined,
    rules: PaymentMappingRule[],
    methods: PaymentMethod[]
  ): string {
    if (!rawPaymentMethod || rawPaymentMethod.trim() === '' || rawPaymentMethod === 'Unknown' || rawPaymentMethod === 'N/A') {
      return 'Unknown';
    }

    const trimmedRaw = rawPaymentMethod.trim();
    const lowerRaw = trimmedRaw.toLowerCase();

    // 1. Evaluate user mapping rules (supports +, & or , for AND combinations)
    let bestRule: PaymentMappingRule | null = null;
    let maxPartsCount = 0;
    let bestPatternLength = 0;

    for (const rule of rules) {
      if (rule.aliasPattern) {
        const parts = rule.aliasPattern.split(/[+&,]/).map((p: string) => p.trim().toLowerCase()).filter(Boolean);
        if (parts.length > 0) {
          const allMatch = parts.every((part: string) => lowerRaw.includes(part));
          if (allMatch) {
            const partsCount = parts.length;
            const patternLength = rule.aliasPattern.length;
            if (partsCount > maxPartsCount || (partsCount === maxPartsCount && patternLength > bestPatternLength)) {
              bestRule = rule;
              maxPartsCount = partsCount;
              bestPatternLength = patternLength;
            }
          }
        }
      }
    }

    if (bestRule) {
      return bestRule.paymentMethodName || 'Unknown';
    }

    // 2. If no rule matches, check exact match
    const exactMatch = methods.find(m => m.name.toLowerCase() === lowerRaw);
    if (exactMatch) {
      return exactMatch.name;
    }

    // 3. Fallback: partial match
    const partialMatch = methods.find(m => lowerRaw.includes(m.name.toLowerCase()));
    if (partialMatch) {
      return partialMatch.name;
    }

    return trimmedRaw;
  }
}

export class EmailClassifier {
  static isTransaction(subject: string): boolean {
    if (subject.toLowerCase().includes('otp')) {
      return false;
    }
    return true;
  }
}

export interface PendingTransaction {
  id: string; // UUID string
  bronzeInputId: string; // Foreign key referencing raw_inputs.id
  userId: string;
  sourceType: string; // e.g. 'email'
  merchantRaw: string;
  merchantNormalized?: string;
  amount: number; // Stored float value
  currency: string;
  transactionDate: string; // ISO UTC string
  inferredCategory?: string;
  confidenceScore?: number;
  status: 'pending' | 'approved' | 'rejected' | 'error';
  extractedAt?: string;
  sourceTitle?: string;
  sourceSender?: string;
  sourceReceivedAt?: string;
  paymentMethod?: string;
  paymentMethodRaw?: string;
  transactionType?: 'expense' | 'refund' | 'transfer' | 'fixed';
  parentTransactionId?: string;
}

export interface Transaction {
  id: string; // UUID string
  pendingTxId?: string; // Foreign key referencing pending_transactions.id (null for direct entries)
  userId: string;
  sourceType: string; // e.g. 'email' or 'manual'
  merchant: string;
  amount: number; // Stored float value
  currency: string;
  transactionDate: string; // ISO UTC string
  category: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  sourceTitle?: string;
  sourceSender?: string;
  sourceReceivedAt?: string;
  bronzeInputId?: string;
  paymentMethod?: string;
  transactionType?: 'expense' | 'refund' | 'transfer' | 'fixed';
  parentTransactionId?: string;
}

export interface PipelineSummaryStats {
  bronzeCount: number;
  bronzeProcessedCount: number;
  bronzeUnprocessedCount: number;
  bronzeRejectedCount: number;
  silverCount: number;
  silverRejectedCount: number;
  goldCount: number;
  goldTotalAmount: number;
}

export interface CycleOverrideData {
  id?: string;
  userId: string;
  cycleName?: string;
  startType: 'default' | 'transaction' | 'date';
  startTransactionId?: string;
  startDate: string;
  startTimestamp: string;
  endDate?: string | null;
  endTimestamp?: string | null;
}

export interface FixedCharge {
  id: string;
  userId: string;
  name: string;
  amount: number;
  currency: string;
  category: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (mandatory)
  paymentMethod?: string;
  createdAt?: string;
}

export interface PaymentMethod {
  id: string;
  userId: string;
  name: string;
}

export interface PaymentMappingRule {
  id: string;
  userId: string;
  aliasPattern: string;
  paymentMethodId: string;
  paymentMethodName?: string;
}

export type CorrectionFieldName = 'merchant' | 'category' | 'paymentMethod' | 'transactionType';

export interface FeedbackSettings {
  isEnabled: boolean;
  maxExamples: number;
  similarityThreshold?: number;
}

export interface CorrectionExample {
  id: string;
  userId: string;
  bronzeInputId: string;
  fieldName: CorrectionFieldName;
  llmValue: string | null;
  correctedValue: string;
  emailSnippet: string | null;
  embedding?: string | null;
  createdAt?: string;
}

export interface FieldAccuracySnapshot {
  merchantAccuracy: number;
  categoryAccuracy: number;
  paymentMethodAccuracy: number;
  totalRecords: number;
}

export interface WeeklyAccuracyEntry {
  week: string;
  merchantAccuracy: number;
  categoryAccuracy: number;
  paymentMethodAccuracy: number;
  totalRecords: number;
}

export interface FeedbackEffectiveness {
  weeklyTrend: WeeklyAccuracyEntry[];
  beforeAfter: {
    cutoffDate: string | null;
    before: FieldAccuracySnapshot | null;
    after: FieldAccuracySnapshot | null;
  };
  coverage: {
    totalExamples: number;
    byField: Record<string, number>;
    historicalMissesByField: Record<string, number>;
  };
}

export interface IFeedbackRepository {
  getFeedbackSettings(userId: string): Promise<FeedbackSettings>;
  saveFeedbackSettings(userId: string, settings: FeedbackSettings): Promise<void>;
  upsertCorrectionExample(example: CorrectionExample): Promise<void>;
  getRecentCorrectionExamples(userId: string, limit: number): Promise<CorrectionExample[]>;
  listCorrectionExamples(userId: string): Promise<CorrectionExample[]>;
  deleteCorrectionExample(id: string, userId: string): Promise<void>;
  clearAllCorrectionExamples(userId: string): Promise<void>;
  getFeedbackEffectiveness(userId: string): Promise<FeedbackEffectiveness>;
}

export interface ITransactionRepository {
  initializeSchema(): Promise<void>;
  emailExists(gmailId: string, userId: string): Promise<boolean>;
  saveRawInput(input: RawInput): Promise<void>;
  savePendingTransaction(tx: PendingTransaction): Promise<void>;
  getPendingTransactions(userId: string): Promise<PendingTransaction[]>;
  promoteToTransaction(pendingId: string, tx: Transaction): Promise<void>;
  addDirectGoldTransaction(tx: Transaction): Promise<void>;
  getRawInputs(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<RawInput[]>;
  getSilverTransactions(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<PendingTransaction[]>;
  getGoldTransactions(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<Transaction[]>;
  updateGoldTransaction(id: string, userId: string, updates: Partial<Transaction>): Promise<void>;
  updatePendingTransaction(id: string, userId: string, updates: Partial<PendingTransaction>): Promise<void>;
  getRawInputById(id: string, userId: string): Promise<RawInput | undefined>;
  updateRawInputClassification(id: string, userId: string, hasTransaction: boolean): Promise<void>;
  updateRawInputStatus(id: string, userId: string, status: 'unprocessed' | 'processed' | 'rejected'): Promise<void>;
  getSilverTransactionByInputId(inputId: string, userId: string): Promise<PendingTransaction | undefined>;
  getSilverTransactionById(id: string, userId: string): Promise<PendingTransaction | undefined>;
  revertGoldToSilver(userId: string, goldId: string): Promise<void>;
  revertSilverToBronze(userId: string, silverId: string): Promise<void>;
  deleteBronzeInput(userId: string, bronzeId: string): Promise<void>;
  restoreBronzeInput(userId: string, bronzeId: string): Promise<void>;
  getDeletedRawInputs(userId: string): Promise<RawInput[]>;
  restoreGoldTransaction(userId: string, goldId: string): Promise<void>;
  getDeletedGoldTransactions(userId: string): Promise<Transaction[]>;
  getLlmExtractionLogByBronzeId(bronzeId: string, userId: string): Promise<any | null>;
  getLlmAccuracyStats(userId: string): Promise<{
    overallAccuracy: number;
    merchantAccuracy: number;
    amountAccuracy: number;
    categoryAccuracy: number;
    paymentMethodAccuracy: number;
    totalTested: number;
  }>;
  close(): Promise<void>;

  // Payment method standardization
  getPaymentMethods(userId: string): Promise<PaymentMethod[]>;
  savePaymentMethod(method: PaymentMethod): Promise<void>;
  updatePaymentMethod(id: string, userId: string, name: string): Promise<void>;
  deletePaymentMethod(id: string, userId: string): Promise<void>;
  getPaymentMappingRules(userId: string): Promise<PaymentMappingRule[]>;
  savePaymentMappingRule(rule: PaymentMappingRule): Promise<void>;
  updatePaymentMappingRule(id: string, userId: string, aliasPattern: string, methodId: string): Promise<void>;
  deletePaymentMappingRule(id: string, userId: string): Promise<void>;
  standardizePaymentMethod(userId: string, rawPaymentMethod: string | undefined): Promise<string>;

  // Fetcher email management
  getFetcherEmails(userId: string): Promise<string[]>;
  saveFetcherEmail(userId: string, email: string): Promise<void>;
  deleteFetcherEmail(userId: string, email: string): Promise<void>;

  // User preferences
  getUserPreferences(userId: string): Promise<{ billingCycleStartDay: number; expectedSalary: number }>;
  updateUserPreferences(userId: string, cycleStartDay: number, expectedSalary: number): Promise<void>;

  // Cycle overrides
  getCycleOverrides(userId: string): Promise<CycleOverrideData[]>;
  upsertCycleOverride(userId: string, override: CycleOverrideData): Promise<void>;
  deleteCycleOverride(userId: string, cycleId: string): Promise<void>;
  isCycleStartAnchor(userId: string, transactionId: string): Promise<boolean>;

  // Fixed charges
  getFixedCharges(userId: string): Promise<FixedCharge[]>;
  saveFixedCharge(charge: FixedCharge): Promise<void>;
  deleteFixedCharge(id: string, userId: string): Promise<void>;
  rejectRawInput(id: string, userId: string): Promise<void>;
  rejectRawInputsBatch(ids: string[], userId: string): Promise<void>;
  approvePendingTransactionsBatch(silverIds: string[], userId: string): Promise<string[]>;
  updatePendingTransactionsBatch(ids: string[], userId: string, updates: Partial<PendingTransaction>): Promise<void>;
  updateGoldTransactionsBatch(ids: string[], userId: string, updates: Partial<Transaction>): Promise<void>;
  getPipelineSummaryStats(userId: string): Promise<PipelineSummaryStats>;
}
