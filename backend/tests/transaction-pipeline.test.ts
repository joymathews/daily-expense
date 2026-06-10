import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';
import { TransactionIngestionService } from '../src/services/transaction-ingestion-service';
import { ITransactionExtractor, ExtractedTransaction, TransactionExtractorFactory } from '../src/services/transaction-extractor';
import { ITransactionRepository } from '../src/db/transaction-repository';
import crypto from 'crypto';

class MockTransactionExtractor implements ITransactionExtractor {
  async extractTransaction(textBody: string): Promise<ExtractedTransaction | null> {
    if (textBody.includes('fail')) {
      return null;
    }
    return {
      merchant: 'Uber Inc',
      amount: 14.50,
      currency: 'USD',
      date: '2023-01-15',
      category: 'Transport',
      description: 'Ride to office',
    };
  }
}

describe('Transaction Processing Pipeline Integration', () => {
  let repository: SQLiteTransactionRepository;
  let extractor: MockTransactionExtractor;
  let service: TransactionIngestionService;

  beforeEach(async () => {
    // Spin up an isolated in-memory SQLite database for test execution
    repository = new SQLiteTransactionRepository(':memory:');
    await repository.initializeSchema();

    extractor = new MockTransactionExtractor();
    service = new TransactionIngestionService(repository, extractor);
  });

  afterEach(async () => {
    await repository.close();
  });

  /**
   * [FUNC-GMAIL-11] Local Email Logging & Audit Trail
   * [FUNC-GMAIL-12] Staging Review Queue
   * Test assertions verify that new transactional emails are successfully logged in raw table
   * and parsed staging results are written to the pending staging table.
   */
  it('should ingest raw email into raw_emails and extract transaction to pending_transactions when transactional', async () => {
    const emailId = 'email_unique_123';
    const rawContent = 'Uber ride invoice: paid USD 14.50 for ride.';
    
    const result = await service.processEmail({
      id: emailId,
      sender: 'rides@uber.com',
      subject: 'Your Ride Details',
      snippet: 'Paid USD 14.50',
      rawBody: rawContent,
      rawPayload: JSON.stringify({ headers: [] }),
      receivedAt: '2023-01-15T10:00:00Z',
      isTransactional: true,
    });

    expect(result.status).toBe('extracted');
    expect(result.extracted).toBeDefined();
    expect(result.extracted.merchantRaw).toBe('Uber Inc');
    expect(result.extracted.amount).toBe(14.50);

    // Verify raw email exists in Bronze raw table
    const exists = await repository.emailExists(emailId);
    expect(exists).toBe(true);

    // Verify staging record exists in Silver staging table
    const pendingList = await repository.getPendingTransactions();
    expect(pendingList).toHaveLength(1);
    expect(pendingList[0].merchantRaw).toBe('Uber Inc');
    expect(pendingList[0].amount).toBe(14.50);
    expect(pendingList[0].currency).toBe('USD');
  });

  /**
   * [FUNC-GMAIL-14] Automatic Duplicate Ingestion Prevention
   * Test verifies that emails with duplicate Message IDs are skipped at the check level
   * to avoid parsing loops and duplicate database insertions.
   */
  it('should skip email ingestion and extraction entirely if the Gmail ID already exists in the system', async () => {
    const emailId = 'duplicate_email_999';
    
    // Ingest the raw email once
    await repository.saveRawEmail({
      id: emailId,
      sender: 'rides@uber.com',
      subject: 'Duplicate Test',
      snippet: 'Snippet',
      rawBody: 'Content text',
      rawPayload: '{}',
      receivedAt: '2023-01-15T10:00:00Z',
    });

    // Run the pipeline process for the same email ID
    const result = await service.processEmail({
      id: emailId,
      sender: 'rides@uber.com',
      subject: 'Duplicate Test',
      snippet: 'Snippet',
      rawBody: 'Content text',
      rawPayload: '{}',
      receivedAt: '2023-01-15T10:00:00Z',
      isTransactional: true,
    });

    // Verify it was skipped
    expect(result.status).toBe('skipped');
    expect(result.extracted).toBeUndefined();

    // Verify that the staging queue is empty (no LLM extraction was triggered)
    const pendingList = await repository.getPendingTransactions();
    expect(pendingList).toHaveLength(0);
  });

  /**
   * [FUNC-GMAIL-13] Review and Final Ledger Approval
   * [NFR-DB-2] Relational Data Coherence
   * Test verifies that promoting a staging row transitions its status to 'approved'
   * and creates a record in the final approved transactions ledger table.
   */
  it('should promote a pending staging transaction to approved and write the confirmed ledger record', async () => {
    const pendingId = 'pending_tx_uuid_555';
    const rawEmailId = 'email_id_555';

    // 1. Setup raw email
    await repository.saveRawEmail({
      id: rawEmailId,
      sender: 'store@market.com',
      subject: 'Receipt',
      snippet: 'Spent 10.00',
      rawBody: 'Details',
      rawPayload: '{}',
      receivedAt: '2023-01-16T12:00:00Z',
    });

    // 2. Setup staging record (Silver)
    await repository.savePendingTransaction({
      id: pendingId,
      rawEmailId: rawEmailId,
      merchantRaw: 'Market Store',
      amount: 10.00,
      currency: 'USD',
      transactionDate: '2023-01-16',
      status: 'pending',
    });

    // 3. Confirm validation and promote to gold transaction ledger
    const confirmTxId = crypto.randomUUID();
    await repository.promoteToTransaction(pendingId, {
      id: confirmTxId,
      pendingTxId: pendingId,
      userId: 'user_test_99',
      merchant: 'Market Store Co.', // edited merchant
      amount: 9.99,                 // edited amount
      currency: 'USD',
      transactionDate: '2023-01-16',
      category: 'Shopping',
      notes: 'Weekly groceries',
    });

    // Verify status was changed in silver staging table (status is not pending anymore)
    const pendingList = await repository.getPendingTransactions();
    expect(pendingList).toHaveLength(0);

    // Verify that silver status query shows status changed (can query directly using SQLite raw check)
    const dbRow = await (repository as any).get('SELECT status, amount_cents FROM silver_extracted_transactions WHERE id = ?', [pendingId]);
    expect(dbRow.status).toBe('approved');
    // Amount in cents should remain what it was originally (1000 cents) since staging shows what model extracted
    expect(dbRow.amount_cents).toBe(1000);

    // Verify final transaction is stored in gold approved transactions
    const goldRow = await (repository as any).get('SELECT * FROM gold_transactions WHERE id = ?', [confirmTxId]);
    expect(goldRow).toBeDefined();
    expect(goldRow.merchant).toBe('Market Store Co.');
    expect(goldRow.amount_cents).toBe(999); // stored as integer cents: 9.99 * 100
    expect(goldRow.category).toBe('Shopping');
  });

  /**
   * [NFR-DB-1] Database Portability & Zero-Recode Migration
   * Test verifies that the business logic pipeline (TransactionIngestionService) is decoupled
   * from any concrete database engine details by interacting exclusively through the ITransactionRepository interface.
   */
  it('enforces database portability by depending purely on the ITransactionRepository abstraction', async () => {
    const mockRepo: ITransactionRepository = {
      initializeSchema: jest.fn().mockResolvedValue(undefined),
      emailExists: jest.fn().mockResolvedValue(false),
      saveRawEmail: jest.fn().mockResolvedValue(undefined),
      savePendingTransaction: jest.fn().mockResolvedValue(undefined),
      getPendingTransactions: jest.fn().mockResolvedValue([]),
      promoteToTransaction: jest.fn().mockResolvedValue(undefined),
      getRawEmails: jest.fn().mockResolvedValue([]),
      getSilverTransactions: jest.fn().mockResolvedValue([]),
      getGoldTransactions: jest.fn().mockResolvedValue([]),
      updateGoldTransaction: jest.fn().mockResolvedValue(undefined),
      updatePendingTransaction: jest.fn().mockResolvedValue(undefined),
      getRawEmailById: jest.fn().mockResolvedValue(undefined),
      getSilverTransactionByEmailId: jest.fn().mockResolvedValue(undefined),
      getSilverTransactionById: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const ingestion = new TransactionIngestionService(mockRepo, extractor);
    await ingestion.processEmail({
      id: 'mock_msg_11',
      sender: 'test@sender.com',
      subject: 'Test',
      snippet: 'test',
      rawBody: 'body',
      rawPayload: '{}',
      receivedAt: '2023-01-15T10:00:00Z',
      isTransactional: false,
    });

    // Verify abstraction method was called instead of direct concrete DB operations
    expect(mockRepo.emailExists).toHaveBeenCalledWith('mock_msg_11');
    expect(mockRepo.saveRawEmail).toHaveBeenCalled();
  });

  /**
   * [FUNC-GMAIL-15] Separate Data View Options
   * [FUNC-GMAIL-16] Date Range Filtering
   * [FUNC-GMAIL-17] On-Demand Ingestion & Batch Extraction
   * [FUNC-GMAIL-18] Confirmed Ledger Corrections
   * [FUNC-GMAIL-20] Data Lineage Tracing
   */
  it('should support strict two-stage medallion processing, batch extraction, corrections, and lineage', async () => {
    const email1 = 'email_batch_1';
    const email2 = 'email_batch_2';

    // Stage 1: Ingest raw emails (Bronze layer only)
    await repository.saveRawEmail({
      id: email1,
      sender: 'store@shop.com',
      subject: 'Receipt 1',
      snippet: 'Paid $10.00',
      rawBody: 'Receipt 1 body content',
      rawPayload: '{}',
      receivedAt: '2023-01-15T12:00:00Z',
    });

    await repository.saveRawEmail({
      id: email2,
      sender: 'taxi@ride.com',
      subject: 'Receipt 2',
      snippet: 'Paid $15.00',
      rawBody: 'Receipt 2 body content',
      rawPayload: '{}',
      receivedAt: '2023-01-16T12:00:00Z',
    });

    // Check Bronze table contents and date filtering
    const allRaw = await repository.getRawEmails();
    expect(allRaw).toHaveLength(2);

    const filteredRaw = await repository.getRawEmails({ startDate: '2023-01-16' });
    expect(filteredRaw).toHaveLength(1);
    expect(filteredRaw[0].id).toBe(email2);

    // Stage 2: Batch extract transaction details to Silver
    const ext1 = await extractor.extractTransaction('Receipt 1 body content');
    const ext2 = await extractor.extractTransaction('Receipt 2 body content');
    
    expect(ext1).toBeDefined();
    expect(ext2).toBeDefined();

    const silverId1 = 'silver_1';
    const silverId2 = 'silver_2';

    await repository.savePendingTransaction({
      id: silverId1,
      rawEmailId: email1,
      merchantRaw: ext1!.merchant,
      amount: ext1!.amount,
      currency: ext1!.currency,
      transactionDate: ext1!.date,
      status: 'pending',
    });

    await repository.savePendingTransaction({
      id: silverId2,
      rawEmailId: email2,
      merchantRaw: ext2!.merchant,
      amount: ext2!.amount,
      currency: ext2!.currency,
      transactionDate: ext2!.date,
      status: 'pending',
    });

    // Verify Silver layer (Staging) exists and supports lineage metadata joins
    const silverList = await repository.getSilverTransactions();
    expect(silverList).toHaveLength(2);
    const item1 = silverList.find(s => s.rawEmailId === email1);
    const item2 = silverList.find(s => s.rawEmailId === email2);
    expect(item1?.emailSubject).toBe('Receipt 1'); // Lineage check
    expect(item2?.emailSubject).toBe('Receipt 2'); // Lineage check

    // Stage 3: Correct and confirm a Silver transaction to Gold ledger
    const goldId = 'gold_1';
    await repository.promoteToTransaction(silverId1, {
      id: goldId,
      pendingTxId: silverId1,
      userId: 'testuser',
      merchant: 'Uber Cleaned', // edited merchant
      amount: 14.99,            // edited amount
      currency: 'USD',
      transactionDate: '2023-01-15',
      category: 'Travel',
    });

    // Verify Silver status changed and values updated
    const silverCheck = await repository.getPendingTransactions();
    // Only 1 pending item left since silverId1 was approved
    expect(silverCheck).toHaveLength(1); // getPendingTransactions fetches pending status

    // Verify Gold record is created with corrected values and tracks lineage
    const goldList = await repository.getGoldTransactions();
    expect(goldList).toHaveLength(1);
    expect(goldList[0].merchant).toBe('Uber Cleaned');
    expect(goldList[0].amount).toBe(14.99);
    expect(goldList[0].emailSubject).toBe('Receipt 1'); // Lineage trace back to Bronze
    expect(goldList[0].bronzeEmailId).toBe(email1);

    // Gold corrections support
    await repository.updateGoldTransaction(goldId, {
      merchant: 'Uber Super Cleaned',
      amount: 15.50,
    });

    const goldUpdated = await repository.getGoldTransactions();
    expect(goldUpdated[0].merchant).toBe('Uber Super Cleaned');
    expect(goldUpdated[0].amount).toBe(15.50);
  });

  /**
   * [NFR-LLM-1] Swap-Ready LLM Ingress
   * Test verifies that the TransactionExtractorFactory resolves the extractor adapter
   * based on the LLM_PROVIDER configuration without editing core client code.
   */
  it('supports swap-ready LLM strategies resolved dynamically via environment variables', () => {
    const originalProvider = process.env.LLM_PROVIDER;
    
    // Switch provider to ollama
    process.env.LLM_PROVIDER = 'ollama';
    const extractorInstance = TransactionExtractorFactory.createExtractor();
    expect(extractorInstance).toBeDefined();
    expect(extractorInstance.constructor.name).toBe('OllamaExtractor');

    // Restore environment
    process.env.LLM_PROVIDER = originalProvider;
  });

  /**
   * [FUNC-GMAIL-19] Raw Email Deduplication
   * Test verifies that duplicate raw email imports are ignored at the database level
   * using Gmail Message ID as a unique natural primary key.
   */
  it('should ignore duplicate raw email imports at the database level using Gmail Message ID as unique primary key', async () => {
    const emailId = 'dedup_test_id_111';
    
    // Insert raw email once
    await repository.saveRawEmail({
      id: emailId,
      sender: 'test@sender.com',
      subject: 'Subject 1',
      snippet: 'Snippet 1',
      rawBody: 'Body 1',
      rawPayload: '{}',
      receivedAt: '2023-01-15T10:00:00Z',
    });

    // Attempt to insert duplicate raw email with different details
    await repository.saveRawEmail({
      id: emailId,
      sender: 'different@sender.com',
      subject: 'Different Subject',
      snippet: 'Different Snippet',
      rawBody: 'Different Body',
      rawPayload: '{}',
      receivedAt: '2023-01-16T10:00:00Z',
    });

    // Retrieve the raw email and verify that the original record was kept (duplicate ignored)
    const email = await repository.getRawEmailById(emailId);
    expect(email).toBeDefined();
    expect(email!.sender).toBe('test@sender.com');
    expect(email!.subject).toBe('Subject 1');
  });

  /**
   * [NFR-ARCH-2] Medallion Separation
   * Test verifies that the database architecture strictly isolates Bronze (raw), Silver (staging),
   * and Gold (ledger) structures, and promotion actions function cleanly without leaving orphaned records.
   */
  it('should strictly isolate Bronze, Silver, and Gold structures in the database', async () => {
    const emailId = 'medallion_email_123';
    const silverId = 'medallion_silver_456';
    const goldId = 'medallion_gold_789';

    // 1. Insert into Bronze (Raw Email)
    await repository.saveRawEmail({
      id: emailId,
      sender: 'merchant@store.com',
      subject: 'Order Confirmation',
      snippet: 'Order details',
      rawBody: 'Item amount: 15.00',
      rawPayload: '{}',
      receivedAt: '2023-01-17T12:00:00Z',
    });

    // Verify raw email exists in Bronze but not in Silver or Gold
    const rawExists = await repository.getRawEmailById(emailId);
    expect(rawExists).toBeDefined();
    
    const silverBefore = await repository.getSilverTransactions();
    expect(silverBefore.some(tx => tx.rawEmailId === emailId)).toBe(false);

    // 2. Extract and save to Silver (Staging)
    await repository.savePendingTransaction({
      id: silverId,
      rawEmailId: emailId,
      merchantRaw: 'Merchant Store',
      amount: 15.00,
      currency: 'USD',
      transactionDate: '2023-01-17',
      status: 'pending',
    });

    // Verify staging record exists in Silver and correctly references Bronze email ID
    const silverList = await repository.getSilverTransactions();
    const silverItem = silverList.find(s => s.id === silverId);
    expect(silverItem).toBeDefined();
    expect(silverItem!.rawEmailId).toBe(emailId);

    // Verify Gold ledger does not yet contain this transaction
    const goldListBefore = await repository.getGoldTransactions();
    expect(goldListBefore.some(g => g.pendingTxId === silverId)).toBe(false);

    // 3. Promote staging record to Gold (Ledger)
    await repository.promoteToTransaction(silverId, {
      id: goldId,
      pendingTxId: silverId,
      userId: 'testuser',
      merchant: 'Merchant Store Inc',
      amount: 15.00,
      currency: 'USD',
      transactionDate: '2023-01-17',
      category: 'Utilities',
    });

    // Verify isolation and linkage:
    // Raw email in Bronze still exists intact
    const rawAfter = await repository.getRawEmailById(emailId);
    expect(rawAfter).toBeDefined();

    // Silver staging record status has transitioned to approved
    const allSilver = await repository.getSilverTransactions();
    const silverTx = allSilver.find(s => s.id === silverId);
    expect(silverTx).toBeDefined();
    expect(silverTx!.status).toBe('approved');

    // Gold ledger contains the promoted transaction linked to Silver
    const goldListAfter = await repository.getGoldTransactions();
    const goldItem = goldListAfter.find(g => g.id === goldId);
    expect(goldItem).toBeDefined();
    expect(goldItem!.pendingTxId).toBe(silverId);
    expect(goldItem!.bronzeEmailId).toBe(emailId);
  });
});
