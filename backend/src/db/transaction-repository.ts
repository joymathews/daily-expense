export interface RawEmail {
  id: string; // Gmail message unique ID
  userId: string;
  sender: string;
  subject: string;
  snippet: string;
  rawBody: string;
  rawPayload: string; // JSON string payload
  receivedAt: string; // ISO UTC string
  ingestedAt?: string; // ISO UTC string
}

export interface PendingTransaction {
  id: string; // UUID string
  rawEmailId: string; // Foreign key referencing raw_emails.id
  userId: string;
  merchantRaw: string;
  merchantNormalized?: string;
  amount: number; // Stored float value (mapping is handled in repo implementation)
  currency: string;
  transactionDate: string; // ISO UTC string
  inferredCategory?: string;
  confidenceScore?: number;
  status: 'pending' | 'approved' | 'rejected';
  extractedAt?: string;
  emailSubject?: string;
  emailSender?: string;
  emailReceivedAt?: string;
}

export interface Transaction {
  id: string; // UUID string
  pendingTxId?: string; // Foreign key referencing pending_transactions.id
  userId: string;
  merchant: string;
  amount: number; // Stored float value
  currency: string;
  transactionDate: string; // ISO UTC string
  category: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  emailSubject?: string;
  emailSender?: string;
  emailReceivedAt?: string;
  bronzeEmailId?: string;
}

export interface ITransactionRepository {
  initializeSchema(): Promise<void>;
  emailExists(gmailId: string, userId: string): Promise<boolean>;
  saveRawEmail(email: RawEmail): Promise<void>;
  savePendingTransaction(tx: PendingTransaction): Promise<void>;
  getPendingTransactions(userId: string): Promise<PendingTransaction[]>;
  promoteToTransaction(pendingId: string, tx: Transaction): Promise<void>;
  getRawEmails(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<RawEmail[]>;
  getSilverTransactions(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<PendingTransaction[]>;
  getGoldTransactions(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<Transaction[]>;
  updateGoldTransaction(id: string, userId: string, updates: Partial<Transaction>): Promise<void>;
  updatePendingTransaction(id: string, userId: string, updates: Partial<PendingTransaction>): Promise<void>;
  getRawEmailById(id: string, userId: string): Promise<RawEmail | undefined>;
  getSilverTransactionByEmailId(emailId: string, userId: string): Promise<PendingTransaction | undefined>;
  getSilverTransactionById(id: string, userId: string): Promise<PendingTransaction | undefined>;
  close(): Promise<void>;
}
