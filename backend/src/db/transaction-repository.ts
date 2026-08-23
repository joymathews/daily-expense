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
  getInspectableTables(): Promise<Array<{ name: string; columns: string[] }>>;
  getTableRows(tableName: string, userId: string, limit: number, offset: number, search?: string): Promise<{ rows: any[]; totalCount: number; columns: string[] }>;
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
