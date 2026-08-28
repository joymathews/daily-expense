import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';
import { TransactionIngestionService } from '../src/services/transaction-ingestion-service';
import { ITransactionExtractor, ExtractedTransaction, TransactionExtractorFactory } from '../src/services/transaction-extractor';
import { ITransactionRepository } from '../src/db/transaction-repository';
import { RemoteHttpExtractor } from '../src/services/remote-extractor';
import crypto from 'crypto';

class MockTransactionExtractor implements ITransactionExtractor {
  async isAvailable(): Promise<boolean> {
    return true;
  }

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
      paymentMethod: 'UPI',
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
  it('should ingest raw email into raw_inputs and extract transaction to pending_transactions when transactional', async () => {
    const emailId = 'email_unique_123';
    const rawContent = 'Uber ride invoice: paid USD 14.50 for ride.';
    
    const result = await service.processEmail({
      id: emailId,
      userId: 'testuser',
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

    // Verify raw input exists in Bronze raw table
    const exists = await repository.emailExists(emailId, 'testuser');
    expect(exists).toBe(true);

    // Verify staging record exists in Silver staging table
    const pendingList = await repository.getPendingTransactions('testuser');
    expect(pendingList).toHaveLength(1);
    expect(pendingList[0].merchantRaw).toBe('Uber Inc');
    expect(pendingList[0].amount).toBe(14.50);
    expect(pendingList[0].currency).toBe('USD');
    expect(pendingList[0].paymentMethod).toBe('UPI');
  });

  /**
   * [FUNC-GMAIL-14] Automatic Duplicate Ingestion Prevention
   * Test verifies that emails with duplicate Message IDs are skipped at the check level
   * to avoid parsing loops and duplicate database insertions.
   */
  it('should skip email ingestion and extraction entirely if the Gmail ID already exists in the system', async () => {
    const emailId = 'duplicate_email_999';
    
    // Ingest the raw input once
    await repository.saveRawInput({
      id: emailId,
      userId: 'testuser',
      sourceType: 'email',
      sender: 'rides@uber.com',
      title: 'Duplicate Test',
      snippet: 'Snippet',
      rawBody: 'Content text',
      rawPayload: '{}',
      receivedAt: '2023-01-15T10:00:00Z',
    });

    // Run the pipeline process for the same email ID
    const result = await service.processEmail({
      id: emailId,
      userId: 'testuser',
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
    const pendingList = await repository.getPendingTransactions('testuser');
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

    // 1. Setup raw input
    await repository.saveRawInput({
      id: rawEmailId,
      userId: 'user_test_99',
      sourceType: 'email',
      sender: 'store@market.com',
      title: 'Receipt',
      snippet: 'Spent 10.00',
      rawBody: 'Details',
      rawPayload: '{}',
      receivedAt: '2023-01-16T12:00:00Z',
    });

    // 2. Setup staging record (Silver)
    await repository.savePendingTransaction({
      id: pendingId,
      bronzeInputId: rawEmailId,
      userId: 'user_test_99',
      sourceType: 'email',
      merchantRaw: 'Market Store',
      amount: 10.00,
      currency: 'USD',
      transactionDate: '2023-01-16',
      status: 'pending',
      paymentMethod: 'HDFC credit card',
    });

    // 3. Confirm validation and promote to gold transaction ledger
    const confirmTxId = crypto.randomUUID();
    await repository.promoteToTransaction(pendingId, {
      id: confirmTxId,
      pendingTxId: pendingId,
      userId: 'user_test_99',
      sourceType: 'email',
      merchant: 'Market Store Co.', // edited merchant
      amount: 9.99,                 // edited amount
      currency: 'USD',
      transactionDate: '2023-01-16',
      category: 'Shopping',
      notes: 'Weekly groceries',
      paymentMethod: 'HDFC credit card',
    });

    // Verify status was changed in silver staging table (status is not pending anymore)
    const pendingList = await repository.getPendingTransactions('user_test_99');
    expect(pendingList).toHaveLength(0);

    // Verify that silver status query shows status changed (can query directly using SQLite raw check)
    const dbRow = await (repository as any).get('SELECT status, amount_cents, payment_method FROM silver_extracted_transactions WHERE id = ?', [pendingId]);
    expect(dbRow.status).toBe('approved');
    // Amount in cents should remain what it was originally (1000 cents) since staging shows what model extracted
    expect(dbRow.amount_cents).toBe(1000);
    expect(dbRow.payment_method).toBe('HDFC credit card');

    // Verify final transaction is stored in gold approved transactions
    const goldRow = await (repository as any).get('SELECT * FROM gold_transactions WHERE id = ?', [confirmTxId]);
    expect(goldRow).toBeDefined();
    expect(goldRow.merchant).toBe('Market Store Co.');
    expect(goldRow.amount_cents).toBe(999); // stored as integer cents: 9.99 * 100
    expect(goldRow.category).toBe('Shopping');
    expect(goldRow.payment_method).toBe('HDFC credit card');
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
      saveRawInput: jest.fn().mockResolvedValue(undefined),
      savePendingTransaction: jest.fn().mockResolvedValue(undefined),
      getPendingTransactions: jest.fn().mockResolvedValue([]),
      promoteToTransaction: jest.fn().mockResolvedValue(undefined),
      addDirectGoldTransaction: jest.fn().mockResolvedValue(undefined),
      getRawInputs: jest.fn().mockResolvedValue([]),
      getSilverTransactions: jest.fn().mockResolvedValue([]),
      getGoldTransactions: jest.fn().mockResolvedValue([]),
      updateGoldTransaction: jest.fn().mockResolvedValue(undefined),
      updatePendingTransaction: jest.fn().mockResolvedValue(undefined),
      getRawInputById: jest.fn().mockResolvedValue(undefined),
      updateRawInputClassification: jest.fn().mockResolvedValue(undefined),
      updateRawInputStatus: jest.fn().mockResolvedValue(undefined),
      getSilverTransactionByInputId: jest.fn().mockResolvedValue(undefined),
      getSilverTransactionById: jest.fn().mockResolvedValue(undefined),
      revertGoldToSilver: jest.fn().mockResolvedValue(undefined),
      revertSilverToBronze: jest.fn().mockResolvedValue(undefined),
      deleteBronzeInput: jest.fn().mockResolvedValue(undefined),
      restoreBronzeInput: jest.fn().mockResolvedValue(undefined),
      getDeletedRawInputs: jest.fn().mockResolvedValue([]),
      restoreGoldTransaction: jest.fn().mockResolvedValue(undefined),
      getDeletedGoldTransactions: jest.fn().mockResolvedValue([]),
      getLlmExtractionLogByBronzeId: jest.fn().mockResolvedValue(null),
      getLlmAccuracyStats: jest.fn().mockResolvedValue({
        overallAccuracy: 100,
        merchantAccuracy: 100,
        amountAccuracy: 100,
        categoryAccuracy: 100,
        paymentMethodAccuracy: 100,
        totalTested: 0
      }),
      close: jest.fn().mockResolvedValue(undefined),
      getPaymentMethods: jest.fn().mockResolvedValue([]),
      savePaymentMethod: jest.fn().mockResolvedValue(undefined),
      updatePaymentMethod: jest.fn().mockResolvedValue(undefined),
      deletePaymentMethod: jest.fn().mockResolvedValue(undefined),
      getPaymentMappingRules: jest.fn().mockResolvedValue([]),
      savePaymentMappingRule: jest.fn().mockResolvedValue(undefined),
      updatePaymentMappingRule: jest.fn().mockResolvedValue(undefined),
      deletePaymentMappingRule: jest.fn().mockResolvedValue(undefined),
      standardizePaymentMethod: jest.fn().mockImplementation((userId, raw) => Promise.resolve(raw || 'Unknown')),
      getFetcherEmails: jest.fn().mockResolvedValue([]),
      saveFetcherEmail: jest.fn().mockResolvedValue(undefined),
      deleteFetcherEmail: jest.fn().mockResolvedValue(undefined),
      getUserPreferences: jest.fn().mockResolvedValue({ billingCycleStartDay: 17, expectedSalary: 100000 }),
      updateUserPreferences: jest.fn().mockResolvedValue(undefined),
      getFixedCharges: jest.fn().mockResolvedValue([]),
      saveFixedCharge: jest.fn().mockResolvedValue(undefined),
      deleteFixedCharge: jest.fn().mockResolvedValue(undefined),
      getCycleOverrides: jest.fn().mockResolvedValue([]),
      upsertCycleOverride: jest.fn().mockResolvedValue(undefined),
      deleteCycleOverride: jest.fn().mockResolvedValue(undefined),
      isCycleStartAnchor: jest.fn().mockResolvedValue(false),
      rejectRawInput: jest.fn().mockResolvedValue(undefined),
      rejectRawInputsBatch: jest.fn().mockResolvedValue(undefined),
      approvePendingTransactionsBatch: jest.fn().mockResolvedValue([]),
      updatePendingTransactionsBatch: jest.fn().mockResolvedValue(undefined),
      updateGoldTransactionsBatch: jest.fn().mockResolvedValue(undefined),
      getInspectableTables: jest.fn().mockResolvedValue([]),
      getTableRows: jest.fn().mockResolvedValue({ rows: [], totalCount: 0, columns: [] }),
    };

    const ingestion = new TransactionIngestionService(mockRepo, extractor);
    await ingestion.processEmail({
      id: 'mock_msg_11',
      userId: 'testuser',
      sender: 'test@sender.com',
      subject: 'Test',
      snippet: 'test',
      rawBody: 'body',
      rawPayload: '{}',
      receivedAt: '2023-01-15T10:00:00Z',
      isTransactional: false,
    });

    // Verify abstraction method was called instead of direct concrete DB operations
    expect(mockRepo.emailExists).toHaveBeenCalledWith('mock_msg_11', 'testuser');
    expect(mockRepo.saveRawInput).toHaveBeenCalled();
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

    // Stage 1: Ingest raw inputs (Bronze layer only)
    await repository.saveRawInput({
      id: email1,
      userId: 'testuser',
      sourceType: 'email',
      sender: 'store@shop.com',
      title: 'Receipt 1',
      snippet: 'Paid $10.00',
      rawBody: 'Receipt 1 body content',
      rawPayload: '{}',
      receivedAt: '2023-01-15T12:00:00Z',
    });

    await repository.saveRawInput({
      id: email2,
      userId: 'testuser',
      sourceType: 'email',
      sender: 'taxi@ride.com',
      title: 'Receipt 2',
      snippet: 'Paid $15.00',
      rawBody: 'Receipt 2 body content',
      rawPayload: '{}',
      receivedAt: '2023-01-16T12:00:00Z',
    });

    // Check Bronze table contents and date filtering
    const allRaw = await repository.getRawInputs('testuser');
    expect(allRaw).toHaveLength(2);

    const filteredRaw = await repository.getRawInputs('testuser', { startDate: '2023-01-16' });
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
      bronzeInputId: email1,
      userId: 'testuser',
      sourceType: 'email',
      merchantRaw: ext1!.merchant,
      amount: ext1!.amount,
      currency: ext1!.currency,
      transactionDate: ext1!.date,
      status: 'pending',
      paymentMethod: ext1!.paymentMethod || 'UPI',
    });

    await repository.savePendingTransaction({
      id: silverId2,
      bronzeInputId: email2,
      userId: 'testuser',
      sourceType: 'email',
      merchantRaw: ext2!.merchant,
      amount: ext2!.amount,
      currency: ext2!.currency,
      transactionDate: ext2!.date,
      status: 'pending',
      paymentMethod: ext2!.paymentMethod || 'UPI',
    });

    // Verify Silver layer (Staging) exists and supports lineage metadata joins
    const silverList = await repository.getSilverTransactions('testuser');
    expect(silverList).toHaveLength(2);
    const item1 = silverList.find(s => s.bronzeInputId === email1);
    const item2 = silverList.find(s => s.bronzeInputId === email2);
    expect(item1?.sourceTitle).toBe('Receipt 1'); // Lineage check
    expect(item2?.sourceTitle).toBe('Receipt 2'); // Lineage check

    // Stage 3: Correct and confirm a Silver transaction to Gold ledger
    const goldId = 'gold_1';
    await repository.promoteToTransaction(silverId1, {
      id: goldId,
      pendingTxId: silverId1,
      userId: 'testuser',
      sourceType: 'email',
      merchant: 'Uber Cleaned', // edited merchant
      amount: 14.99,            // edited amount
      currency: 'USD',
      transactionDate: '2023-01-15',
      category: 'Travel',
      paymentMethod: 'UPI',
    });

    // Verify Silver status changed and values updated
    const silverCheck = await repository.getPendingTransactions('testuser');
    // Only 1 pending item left since silverId1 was approved
    expect(silverCheck).toHaveLength(1); // getPendingTransactions fetches pending status

    // Verify Gold record is created with corrected values and tracks lineage
    const goldList = await repository.getGoldTransactions('testuser');
    expect(goldList).toHaveLength(1);
    expect(goldList[0].merchant).toBe('Uber Cleaned');
    expect(goldList[0].amount).toBe(14.99);
    expect(goldList[0].sourceTitle).toBe('Receipt 1'); // Lineage trace back to Bronze
    expect(goldList[0].bronzeInputId).toBe(email1);

    // Gold corrections support
    await repository.updateGoldTransaction(goldId, 'testuser', {
      merchant: 'Uber Super Cleaned',
      amount: 15.50,
    });

    const goldUpdated = await repository.getGoldTransactions('testuser');
    expect(goldUpdated[0].merchant).toBe('Uber Super Cleaned');
    expect(goldUpdated[0].amount).toBe(15.50);
  });

  /**
   * [NFR-LLM-1] Swap-Ready LLM Ingress
   * Test verifies that the TransactionExtractorFactory resolves the extractor adapter
   * based on the LLM_PROVIDER configuration without editing core client code.
   */
  it('supports swap-ready LLM strategies resolved dynamically via environment variables', () => {
    const extractorInstance = TransactionExtractorFactory.createExtractor();
    expect(extractorInstance).toBeDefined();
    expect(extractorInstance.constructor.name).toBe('RemoteHttpExtractor');
  });

  /**
   * [FUNC-GMAIL-43] LLM Category Extraction Inference
   * [NFR-GMAIL-6] Category Extraction Robustness
   */
  it('should infer category from overall context using RemoteHttpExtractor', async () => {
    const extractor = new RemoteHttpExtractor('http://localhost:3002', 'dev-secret');

    const mockFetch = jest.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          transaction: {
            merchant: 'Uber Inc',
            amount: 14.50,
            currency: 'USD',
            date: '2026-06-12',
            category: 'Cabs & Transport',
            paymentMethod: 'UPI',
            transactionType: 'expense'
          }
        })
      });
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch as any;

    try {
      const result = await extractor.extractTransaction('Uber ride receipt detail');
      expect(result).not.toBeNull();
      expect(result?.merchant).toBe('Uber Inc');
      expect(result?.category).toBe('Cabs & Transport');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3002/api/v1/extract',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Uber ride receipt detail')
        })
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  /**
   * [FUNC-GMAIL-19] Raw Email Deduplication
   * Test verifies that duplicate raw email imports are ignored at the database level
   * using Gmail Message ID as a unique natural primary key.
   */
  it('should ignore duplicate raw email imports at the database level using Gmail Message ID as unique primary key', async () => {
    const emailId = 'dedup_test_id_111';
    
    // Insert raw input once
    await repository.saveRawInput({
      id: emailId,
      userId: 'testuser',
      sourceType: 'email',
      sender: 'test@sender.com',
      title: 'Subject 1',
      snippet: 'Snippet 1',
      rawBody: 'Body 1',
      rawPayload: '{}',
      receivedAt: '2023-01-15T10:00:00Z',
    });

    // Attempt to insert duplicate raw email with different details
    await repository.saveRawInput({
      id: emailId,
      userId: 'testuser',
      sourceType: 'email',
      sender: 'different@sender.com',
      title: 'Different Subject',
      snippet: 'Different Snippet',
      rawBody: 'Different Body',
      rawPayload: '{}',
      receivedAt: '2023-01-16T10:00:00Z',
    });

    // Retrieve the raw input and verify that the original record was kept (duplicate ignored)
    const email = await repository.getRawInputById(emailId, 'testuser');
    expect(email).toBeDefined();
    expect(email!.sender).toBe('test@sender.com');
    expect(email!.title).toBe('Subject 1');
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
    await repository.saveRawInput({
      id: emailId,
      userId: 'testuser',
      sourceType: 'email',
      sender: 'merchant@store.com',
      title: 'Order Confirmation',
      snippet: 'Order details',
      rawBody: 'Item amount: 15.00',
      rawPayload: '{}',
      receivedAt: '2023-01-17T12:00:00Z',
    });

    // Verify raw input exists in Bronze but not in Silver or Gold
    const rawExists = await repository.getRawInputById(emailId, 'testuser');
    expect(rawExists).toBeDefined();
    
    const silverBefore = await repository.getSilverTransactions('testuser');
    expect(silverBefore.some(tx => tx.bronzeInputId === emailId)).toBe(false);

    // 2. Extract and save to Silver (Staging)
    await repository.savePendingTransaction({
      id: silverId,
      bronzeInputId: emailId,
      userId: 'testuser',
      sourceType: 'email',
      merchantRaw: 'Merchant Store',
      amount: 15.00,
      currency: 'USD',
      transactionDate: '2023-01-17',
      status: 'pending',
      paymentMethod: 'Credit Card',
    });

    // Verify staging record exists in Silver and correctly references Bronze email ID
    const silverList = await repository.getSilverTransactions('testuser');
    const silverItem = silverList.find(s => s.id === silverId);
    expect(silverItem).toBeDefined();
    expect(silverItem!.bronzeInputId).toBe(emailId);

    // Verify Gold ledger does not yet contain this transaction
    const goldListBefore = await repository.getGoldTransactions('testuser');
    expect(goldListBefore.some(g => g.pendingTxId === silverId)).toBe(false);

    // 3. Promote staging record to Gold (Ledger)
    await repository.promoteToTransaction(silverId, {
      id: goldId,
      pendingTxId: silverId,
      userId: 'testuser',
      sourceType: 'email',
      merchant: 'Merchant Store Inc',
      amount: 15.00,
      currency: 'USD',
      transactionDate: '2023-01-17',
      category: 'Utilities',
      paymentMethod: 'Credit Card',
    });

    // Verify isolation and lineage:
    // Raw input in Bronze still exists intact
    const rawAfter = await repository.getRawInputById(emailId, 'testuser');
    expect(rawAfter).toBeDefined();

    // Silver staging record status has transitioned to approved
    const allSilver = await repository.getSilverTransactions('testuser');
    const silverTx = allSilver.find(s => s.id === silverId);
    expect(silverTx).toBeDefined();
    expect(silverTx!.status).toBe('approved');

    // Gold ledger contains the promoted transaction linked to Silver
    const goldListAfter = await repository.getGoldTransactions('testuser');
    const goldItem = goldListAfter.find(g => g.id === goldId);
    expect(goldItem).toBeDefined();
    expect(goldItem!.pendingTxId).toBe(silverId);
    expect(goldItem!.bronzeInputId).toBe(emailId);
  });

  /**
   * [FUNC-GMAIL-24] Payment Method Extraction
   * [FUNC-GMAIL-25] Staging Payment Review & Editing
   * [FUNC-GMAIL-26] Verified Ledger Method Display & Correction
   * [NFR-GMAIL-3] Payment Classification Robustness
   */
  it('should support payment method end-to-end extraction, editing, promotion, and ledger corrections', async () => {
    const emailId = 'pm_email_101';
    const silverId = 'pm_silver_202';
    const goldId = 'pm_gold_303';
    const userId = 'user_pm_test';

    // 1. Ingest Bronze layer
    await repository.saveRawInput({
      id: emailId,
      userId,
      sourceType: 'email',
      sender: 'upi@bank.com',
      title: 'UPI Payment Alert',
      snippet: 'Paid INR 250 via UPI',
      rawBody: 'Tx Details: Paid to Merchant X via UPI.',
      rawPayload: '{}',
      receivedAt: '2026-06-11T12:00:00Z',
    });

    // 2. Extract transaction (Simulating LLM extraction)
    const extractionResult = await extractor.extractTransaction('Tx Details: Paid to Merchant X via UPI.');
    expect(extractionResult).toBeDefined();
    expect(extractionResult!.paymentMethod).toBe('UPI'); // Verify mock returns payment method

    // 3. Save extracted to Silver (Staging)
    await repository.savePendingTransaction({
      id: silverId,
      bronzeInputId: emailId,
      userId,
      sourceType: 'email',
      merchantRaw: extractionResult!.merchant,
      amount: extractionResult!.amount,
      currency: extractionResult!.currency,
      transactionDate: extractionResult!.date,
      status: 'pending',
      paymentMethod: extractionResult!.paymentMethod,
    });

    // Verify Silver details displays extracted payment method
    let pendingList = await repository.getPendingTransactions(userId);
    expect(pendingList).toHaveLength(1);
    expect(pendingList[0].paymentMethod).toBe('UPI');

    // 4. Staging Payment Review & Editing: Modify the payment method in staging (e.g. from 'UPI' to 'HDFC Rupay Card')
    await repository.updatePendingTransaction(silverId, userId, {
      paymentMethod: 'HDFC Rupay Card',
      merchantRaw: 'Uber Cleaned',
    });

    pendingList = await repository.getPendingTransactions(userId);
    expect(pendingList[0].paymentMethod).toBe('HDFC Rupay Card');
    expect(pendingList[0].merchantRaw).toBe('Uber Cleaned');

    // 5. Promote and verify it reaches Gold ledger with correct payment method
    await repository.promoteToTransaction(silverId, {
      id: goldId,
      pendingTxId: silverId,
      userId,
      sourceType: 'email',
      merchant: 'Uber Cleaned',
      amount: 14.50,
      currency: 'USD',
      transactionDate: '2023-01-15',
      category: 'Transport',
      paymentMethod: 'HDFC Rupay Card',
    });

    let goldList = await repository.getGoldTransactions(userId);
    expect(goldList).toHaveLength(1);
    expect(goldList[0].paymentMethod).toBe('HDFC Rupay Card');

    // 6. Gold corrections support: User updates payment method in gold ledger
    await repository.updateGoldTransaction(goldId, userId, {
      paymentMethod: 'HDFC credit card',
    });

    goldList = await repository.getGoldTransactions(userId);
    expect(goldList[0].paymentMethod).toBe('HDFC credit card');
  });
});
