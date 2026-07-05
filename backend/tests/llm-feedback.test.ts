import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';
import { CorrectionLearningService } from '../src/services/correction-learning-service';

/**
 * LLM Feedback Learning Test Suite
 * Tests: [FUNC-FEEDBACK-1], [FUNC-FEEDBACK-2], [FUNC-FEEDBACK-3], [FUNC-FEEDBACK-4], [FUNC-AUTH-4]
 */
describe('LLM Feedback Learning', () => {
  const userId = 'user-feedback-test';
  const otherUserId = 'user-other-feedback';
  const testDbPath = path.resolve(__dirname, '../data/test_feedback.db');
  let repository: SQLiteTransactionRepository;
  let service: CorrectionLearningService;

  const createRawInput = async (id: string, uid: string, body = 'Email body content about a transaction') => {
    await repository.saveRawInput({
      id,
      userId: uid,
      sourceType: 'email',
      sender: 'merchant@example.com',
      title: 'Transaction Alert',
      snippet: 'Paid for item',
      rawBody: body,
      rawPayload: '{}',
      receivedAt: new Date().toISOString(),
      hasTransaction: true,
      status: 'unprocessed',
    });
  };

  const createPendingTransaction = async (bronzeId: string, uid: string) => {
    const id = crypto.randomUUID();
    await repository.savePendingTransaction({
      id,
      bronzeInputId: bronzeId,
      userId: uid,
      sourceType: 'email',
      merchantRaw: 'MerchantLLM',
      merchantNormalized: 'MerchantLLM',
      amount: 100.0,
      currency: 'INR',
      transactionDate: '2026-01-15',
      inferredCategory: 'Shopping',
      confidenceScore: 0.9,
      status: 'pending',
      paymentMethod: 'Cash',
      paymentMethodRaw: 'HDFC',
      transactionType: 'expense',
    });
    return id;
  };

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    process.env.DATABASE_URL = testDbPath;
    repository = new SQLiteTransactionRepository(testDbPath);
    await repository.initializeSchema();
    service = new CorrectionLearningService();
  });

  afterEach(async () => {
    await repository.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  // ---------------------------------------------------------------------------
  // Settings CRUD
  // ---------------------------------------------------------------------------

  describe('Feedback Settings [FUNC-FEEDBACK-2, FUNC-FEEDBACK-3]', () => {
    it('returns disabled state with 10 examples by default when no setting has been saved', async () => {
      const settings = await repository.getFeedbackSettings(userId);
      expect(settings.isEnabled).toBe(false);
      expect(settings.maxExamples).toBe(10);
      expect(settings.similarityThreshold).toBe(0.3);
    });

    it('persists enabled state and custom maxExamples correctly', async () => {
      await repository.saveFeedbackSettings(userId, { isEnabled: true, maxExamples: 25, similarityThreshold: 0.6 });
      const settings = await repository.getFeedbackSettings(userId);
      expect(settings.isEnabled).toBe(true);
      expect(settings.maxExamples).toBe(25);
      expect(settings.similarityThreshold).toBe(0.6);
    });

    it('can be toggled back to disabled after being enabled', async () => {
      await repository.saveFeedbackSettings(userId, { isEnabled: true, maxExamples: 10, similarityThreshold: 0.3 });
      await repository.saveFeedbackSettings(userId, { isEnabled: false, maxExamples: 10, similarityThreshold: 0.3 });
      const settings = await repository.getFeedbackSettings(userId);
      expect(settings.isEnabled).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Correction capture disabled
  // ---------------------------------------------------------------------------

  describe('captureCorrectionsIfEnabled — when feature is disabled [FUNC-FEEDBACK-2]', () => {
    it('stores no examples when feature is disabled (default state)', async () => {
      const bronzeId = crypto.randomUUID();
      await createRawInput(bronzeId, userId);
      await createPendingTransaction(bronzeId, userId);

      await service.captureCorrectionsIfEnabled({
        userId,
        bronzeInputId: bronzeId,
        emailBody: 'Some email body',
        llmLog: { extractedMerchant: 'LLM Merchant', extractedCategory: 'Shopping', extractedPaymentMethod: 'Unknown', extractedTransactionType: 'expense' },
        savedValues: { merchant: 'Corrected Merchant', category: 'Online Food Order', paymentMethod: 'HDFC UPI', transactionType: 'expense' },
        repository,
      });

      const examples = await repository.listCorrectionExamples(userId);
      expect(examples).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Correction capture enabled
  // ---------------------------------------------------------------------------

  describe('captureCorrectionsIfEnabled — when feature is enabled [FUNC-FEEDBACK-1]', () => {
    beforeEach(async () => {
      await repository.saveFeedbackSettings(userId, { isEnabled: true, maxExamples: 10 });
    });

    it('saves a correction example for each field that genuinely differs from the LLM log', async () => {
      const bronzeId = crypto.randomUUID();
      await createRawInput(bronzeId, userId);
      await createPendingTransaction(bronzeId, userId);

      await service.captureCorrectionsIfEnabled({
        userId,
        bronzeInputId: bronzeId,
        emailBody: 'Swiggy order receipt for food delivery.',
        llmLog: { extractedMerchant: 'Swiggy', extractedCategory: 'Shopping', extractedPaymentMethod: 'Unknown', extractedTransactionType: 'expense' },
        savedValues: { merchant: 'Swiggy', category: 'Online Food Order', paymentMethod: 'HDFC UPI', transactionType: 'expense' },
        repository,
      });

      const examples = await repository.listCorrectionExamples(userId);
      // category: Shopping → Online Food Order (changed)
      // paymentMethod: Unknown → HDFC UPI (changed)
      // merchant: Swiggy → Swiggy (same — NOT captured)
      // transactionType: expense → expense (same — NOT captured)
      expect(examples).toHaveLength(2);
      const fields = examples.map(ex => ex.fieldName);
      expect(fields).toContain('category');
      expect(fields).toContain('paymentMethod');
      expect(fields).not.toContain('merchant');
      expect(fields).not.toContain('transactionType');
    });

    it('does not save a correction example when the user approves with no field changes', async () => {
      const bronzeId = crypto.randomUUID();
      await createRawInput(bronzeId, userId);
      await createPendingTransaction(bronzeId, userId);

      await service.captureCorrectionsIfEnabled({
        userId,
        bronzeInputId: bronzeId,
        emailBody: 'Amazon order.',
        llmLog: { extractedMerchant: 'Amazon', extractedCategory: 'Shopping', extractedPaymentMethod: 'HDFC Credit Card', extractedTransactionType: 'expense' },
        savedValues: { merchant: 'Amazon', category: 'Shopping', paymentMethod: 'HDFC Credit Card', transactionType: 'expense' },
        repository,
      });

      const examples = await repository.listCorrectionExamples(userId);
      expect(examples).toHaveLength(0);
    });

    it('upserts (replaces) an existing example when the same field is re-corrected', async () => {
      const bronzeId = crypto.randomUUID();
      await createRawInput(bronzeId, userId);
      await createPendingTransaction(bronzeId, userId);

      // First correction
      await service.captureCorrectionsIfEnabled({
        userId,
        bronzeInputId: bronzeId,
        emailBody: 'Email body.',
        llmLog: { extractedMerchant: null, extractedCategory: 'Shopping', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
        savedValues: { category: 'Online Food Order' },
        repository,
      });

      // Second correction to same field
      await service.captureCorrectionsIfEnabled({
        userId,
        bronzeInputId: bronzeId,
        emailBody: 'Email body.',
        llmLog: { extractedMerchant: null, extractedCategory: 'Shopping', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
        savedValues: { category: 'Restaurant & Dining' },
        repository,
      });

      const examples = await repository.listCorrectionExamples(userId);
      // Must still be only 1 row for this bronzeId/field pair
      expect(examples).toHaveLength(1);
      expect(examples[0].correctedValue).toBe('Restaurant & Dining');
    });

    it('stores the email snippet in the correction example', async () => {
      const bronzeId = crypto.randomUUID();
      const emailBody = 'Your Zomato order has been delivered. Total: ₹450. Paid via HDFC UPI.';
      await createRawInput(bronzeId, userId, emailBody);
      await createPendingTransaction(bronzeId, userId);

      await service.captureCorrectionsIfEnabled({
        userId,
        bronzeInputId: bronzeId,
        emailBody,
        llmLog: { extractedMerchant: null, extractedCategory: 'Shopping', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
        savedValues: { category: 'Online Food Order' },
        repository,
      });

      const examples = await repository.listCorrectionExamples(userId);
      expect(examples[0].emailSnippet).not.toBeNull();
      expect(examples[0].emailSnippet).toContain('Zomato');
    });
  });

  // ---------------------------------------------------------------------------
  // User isolation [FUNC-AUTH-4]
  // ---------------------------------------------------------------------------

  describe('User isolation [FUNC-AUTH-4]', () => {
    it('correction examples captured for user A are not visible to user B', async () => {
      await repository.saveFeedbackSettings(userId, { isEnabled: true, maxExamples: 10 });

      const bronzeId = crypto.randomUUID();
      await createRawInput(bronzeId, userId);
      await createPendingTransaction(bronzeId, userId);

      await service.captureCorrectionsIfEnabled({
        userId,
        bronzeInputId: bronzeId,
        emailBody: 'Email body',
        llmLog: { extractedMerchant: null, extractedCategory: 'Shopping', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
        savedValues: { category: 'Medical & Healthcare' },
        repository,
      });

      const examplesForOtherUser = await repository.listCorrectionExamples(otherUserId);
      expect(examplesForOtherUser).toHaveLength(0);

      const examplesForUser = await repository.listCorrectionExamples(userId);
      expect(examplesForUser).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Few-shot prompt block generation [FUNC-FEEDBACK-1, FUNC-FEEDBACK-3]
  // ---------------------------------------------------------------------------

  describe('buildFewShotPromptBlock [FUNC-FEEDBACK-1, FUNC-FEEDBACK-3]', () => {
    it('returns an empty string when the feature is disabled', async () => {
      const block = await service.buildFewShotPromptBlock(userId, repository);
      expect(block).toBe('');
    });

    it('returns an empty string when enabled but no examples exist', async () => {
      await repository.saveFeedbackSettings(userId, { isEnabled: true, maxExamples: 10 });
      const block = await service.buildFewShotPromptBlock(userId, repository);
      expect(block).toBe('');
    });

    it('returns a non-empty formatted prompt block when examples exist', async () => {
      await repository.saveFeedbackSettings(userId, { isEnabled: true, maxExamples: 10 });

      const bronzeId = crypto.randomUUID();
      await createRawInput(bronzeId, userId, 'Zomato order receipt for food delivery.');
      await createPendingTransaction(bronzeId, userId);

      await service.captureCorrectionsIfEnabled({
        userId,
        bronzeInputId: bronzeId,
        emailBody: 'Zomato order receipt for food delivery.',
        llmLog: { extractedMerchant: null, extractedCategory: 'Shopping', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
        savedValues: { category: 'Online Food Order' },
        repository,
      });

      const block = await service.buildFewShotPromptBlock(userId, repository);
      expect(block).toContain('Correction History');
      expect(block).toContain('category');
      expect(block).toContain('Shopping');
      expect(block).toContain('Online Food Order');
    });

    it('respects the maxExamples limit and returns at most N examples [FUNC-FEEDBACK-3]', async () => {
      await repository.saveFeedbackSettings(userId, { isEnabled: true, maxExamples: 2 });

      // Insert 3 examples for 3 different bronze inputs
      for (let i = 0; i < 3; i++) {
        const bronzeId = crypto.randomUUID();
        await createRawInput(bronzeId, userId);
        await createPendingTransaction(bronzeId, userId);
        await service.captureCorrectionsIfEnabled({
          userId,
          bronzeInputId: bronzeId,
          emailBody: `Email body ${i}`,
          llmLog: { extractedMerchant: null, extractedCategory: 'Shopping', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
          savedValues: { category: `Category ${i}` },
          repository,
        });
      }

      const examples = await repository.getRecentCorrectionExamples(userId, 2);
      expect(examples).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Example management [FUNC-FEEDBACK-4]
  // ---------------------------------------------------------------------------

  describe('Correction example management [FUNC-FEEDBACK-4]', () => {
    beforeEach(async () => {
      await repository.saveFeedbackSettings(userId, { isEnabled: true, maxExamples: 10 });
    });

    it('deleteCorrectionExample removes only the target example', async () => {
      const bronzeId1 = crypto.randomUUID();
      const bronzeId2 = crypto.randomUUID();
      await createRawInput(bronzeId1, userId);
      await createRawInput(bronzeId2, userId);
      await createPendingTransaction(bronzeId1, userId);
      await createPendingTransaction(bronzeId2, userId);

      await service.captureCorrectionsIfEnabled({
        userId, bronzeInputId: bronzeId1, emailBody: 'body1',
        llmLog: { extractedMerchant: null, extractedCategory: 'Shopping', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
        savedValues: { category: 'Groceries' }, repository,
      });
      await service.captureCorrectionsIfEnabled({
        userId, bronzeInputId: bronzeId2, emailBody: 'body2',
        llmLog: { extractedMerchant: null, extractedCategory: 'Shopping', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
        savedValues: { category: 'Medical & Healthcare' }, repository,
      });

      const allBefore = await repository.listCorrectionExamples(userId);
      expect(allBefore).toHaveLength(2);

      await repository.deleteCorrectionExample(allBefore[0].id, userId);
      const allAfter = await repository.listCorrectionExamples(userId);
      expect(allAfter).toHaveLength(1);
    });

    it('clearAllCorrectionExamples removes all examples for the user', async () => {
      const bronzeId = crypto.randomUUID();
      await createRawInput(bronzeId, userId);
      await createPendingTransaction(bronzeId, userId);

      await service.captureCorrectionsIfEnabled({
        userId, bronzeInputId: bronzeId, emailBody: 'body',
        llmLog: { extractedMerchant: null, extractedCategory: 'Shopping', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
        savedValues: { category: 'Groceries' }, repository,
      });

      await repository.clearAllCorrectionExamples(userId);
      const examples = await repository.listCorrectionExamples(userId);
      expect(examples).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Effectiveness observability [FUNC-FEEDBACK-1]
  // ---------------------------------------------------------------------------

  describe('Observability effectiveness report [FUNC-FEEDBACK-1]', () => {
    it('returns empty/default statistics when no transactions or corrections exist', async () => {
      const report = await repository.getFeedbackEffectiveness(userId);
      expect(report.weeklyTrend).toEqual([]);
      expect(report.beforeAfter.cutoffDate).toBeNull();
      expect(report.beforeAfter.before).toBeNull();
      expect(report.beforeAfter.after).toBeNull();
      expect(report.coverage.totalExamples).toBe(0);
    });

    it('calculates coverage and correctness statistics accurately', async () => {
      // 1. Enable settings and add one correction
      await repository.saveFeedbackSettings(userId, { isEnabled: true, maxExamples: 10 });
      const bronzeId = crypto.randomUUID();
      await createRawInput(bronzeId, userId, 'Receipt context.');
      const silverId = await createPendingTransaction(bronzeId, userId);

      await service.captureCorrectionsIfEnabled({
        userId,
        bronzeInputId: bronzeId,
        emailBody: 'Receipt context.',
        llmLog: {
          extractedMerchant: 'Swiggy LLC',
          extractedCategory: 'Shopping',
          extractedPaymentMethod: 'Cash',
          extractedTransactionType: 'expense',
        },
        savedValues: {
          merchant: 'Swiggy',
          category: 'Online Food Order',
          paymentMethod: 'Cash', // not a correction
        },
        repository,
      });

      // 2. Add an approved transaction so it counts towards accuracy
      // This will match 'Swiggy' and 'Online Food Order' but we promoted it
      // Let's insert a Gold ledger row joined with LLM log
      await repository.promoteToTransaction(silverId, {
        id: crypto.randomUUID(),
        pendingTxId: silverId,
        userId,
        sourceType: 'email',
        merchant: 'Swiggy',
        amount: 100,
        currency: 'INR',
        transactionDate: '2026-01-15',
        category: 'Online Food Order',
        notes: '',
        paymentMethod: 'Cash',
        transactionType: 'expense',
      });

      const report = await repository.getFeedbackEffectiveness(userId);

      // We had 2 corrections (merchant and category)
      expect(report.coverage.totalExamples).toBe(2);
      expect(report.coverage.byField.merchant).toBe(1);
      expect(report.coverage.byField.category).toBe(1);
      expect(report.coverage.byField.paymentMethod).toBe(0);

      // Check weekly trend exists
      expect(report.weeklyTrend.length).toBeGreaterThan(0);
      expect(report.weeklyTrend[0].merchantAccuracy).toBe(0);
      expect(report.weeklyTrend[0].categoryAccuracy).toBe(0);

      // Since we had a cutoff date, before/after should be populated (or at least evaluated)
      expect(report.beforeAfter.cutoffDate).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Semantic Embedding Routing [FUNC-FEEDBACK-1]
  // ---------------------------------------------------------------------------

  describe('Semantic Embedding-based Routing [FUNC-FEEDBACK-1]', () => {
    let originalFetch: any;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('calculates correct cosine similarity for vectors', () => {
      const s = service as any;
      // Orthogonal vectors similarity = 0
      expect(s.cosineSimilarity([1, 0], [0, 1])).toBe(0);
      // Identical vectors similarity = 1
      expect(s.cosineSimilarity([3, 4], [3, 4])).toBeCloseTo(1.0);
      // Opposing vectors similarity = -1
      expect(s.cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1.0);
    });

    it('gracefully falls back to recency ordering when embedding query fails', async () => {
      // Mock fetch returning offline error
      global.fetch = jest.fn().mockImplementation(() => Promise.reject(new Error('Offline')));

      await repository.saveFeedbackSettings(userId, { isEnabled: true, maxExamples: 10, similarityThreshold: 0.3 });
      
      const bronzeId = crypto.randomUUID();
      await createRawInput(bronzeId, userId, 'Receipt text');
      await createPendingTransaction(bronzeId, userId);

      await service.captureCorrectionsIfEnabled({
        userId, bronzeInputId: bronzeId, emailBody: 'Receipt text',
        llmLog: { extractedMerchant: null, extractedCategory: 'Shopping', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
        savedValues: { category: 'Groceries' }, repository,
      });

      const block = await service.buildFewShotPromptBlock(userId, repository, 'New receipt text');
      // Should still return block using fallback ordering
      expect(block).toContain('Correction History');
      expect(block).toContain('Groceries');
    });

    it('selects the most semantically relevant examples over unrelated ones', async () => {
      await repository.saveFeedbackSettings(userId, { isEnabled: true, maxExamples: 1, similarityThreshold: 0.2 });

      // Insert 2 examples with distinct template signatures
      const bronzeIdA = crypto.randomUUID();
      await createRawInput(bronzeIdA, userId, 'Zomato order details for lunch');
      await createPendingTransaction(bronzeIdA, userId);
      
      const bronzeIdB = crypto.randomUUID();
      await createRawInput(bronzeIdB, userId, 'Uber taxi cab receipt');
      await createPendingTransaction(bronzeIdB, userId);

      // We will mock fetch to return different embeddings based on the prompt text:
      // Zomato prompt gets [1, 0], Uber prompt gets [0, 1]
      global.fetch = jest.fn().mockImplementation((url, init: any) => {
        const body = JSON.parse(init.body);
        let embedding = [0.1, 0.1];
        if (body.prompt.includes('Zomato')) embedding = [1.0, 0.0];
        if (body.prompt.includes('Uber')) embedding = [0.0, 1.0];
        
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ embedding })
        });
      });

      // Capture Zomato correction (will be embedded as [1, 0])
      await service.captureCorrectionsIfEnabled({
        userId, bronzeInputId: bronzeIdA, emailBody: 'Zomato order details for lunch',
        llmLog: { extractedMerchant: null, extractedCategory: 'Shopping', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
        savedValues: { category: 'Online Food Order' }, repository,
      });

      // Capture Uber correction (will be embedded as [0, 1])
      await service.captureCorrectionsIfEnabled({
        userId, bronzeInputId: bronzeIdB, emailBody: 'Uber taxi cab receipt',
        llmLog: { extractedMerchant: null, extractedCategory: 'Shopping', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
        savedValues: { category: 'Cabs & Transport' }, repository,
      });

      // Querying with an Uber-like email (will fetch embedding [0, 1])
      // Should score Uber example as similarity = 1.0, and Zomato as similarity = 0.0
      // Since maxExamples is 1, it must return ONLY the Uber cabs correction example!
      const block = await service.buildFewShotPromptBlock(userId, repository, 'Uber ride to airport');
      expect(block).toContain('Cabs & Transport');
      expect(block).not.toContain('Online Food Order');
    });

    it('filters out examples below the similarity threshold', async () => {
      await repository.saveFeedbackSettings(userId, { isEnabled: true, maxExamples: 10, similarityThreshold: 0.8 });

      global.fetch = jest.fn().mockImplementation((url, init: any) => {
        const body = JSON.parse(init.body);
        let embedding = [1.0, 0.0]; // saved
        if (body.prompt.includes('Query')) embedding = [0.1, 0.9]; // query (unrelated)
        
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ embedding })
        });
      });

      const bronzeId = crypto.randomUUID();
      await createRawInput(bronzeId, userId, 'Merchant A invoice');
      await createPendingTransaction(bronzeId, userId);

      await service.captureCorrectionsIfEnabled({
        userId, bronzeInputId: bronzeId, emailBody: 'Merchant A invoice',
        llmLog: { extractedMerchant: null, extractedCategory: 'Shopping', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
        savedValues: { category: 'Online Food Order' }, repository,
      });

      // Query with unrelated text. Similarity will be low (~0.1).
      // Since threshold is 0.8, it must return an empty block.
      const block = await service.buildFewShotPromptBlock(userId, repository, 'Query text');
      expect(block).toBe('');
    });

    it('ignores auto-applied rule changes when the user does not edit them', async () => {
      await repository.saveFeedbackSettings(userId, { isEnabled: true, maxExamples: 10, similarityThreshold: 0.0 });

      const bronzeId = crypto.randomUUID();
      await createRawInput(bronzeId, userId, 'Merchant invoice');
      await createPendingTransaction(bronzeId, userId);

      // Scenario: LLM extracted 'Raw Category'.
      // Staging draft got 'Shopping' (via backend standard rule mapping).
      // Saved/approved value is 'Shopping' (user accepted without editing).
      await service.captureCorrectionsIfEnabled({
        userId,
        bronzeInputId: bronzeId,
        emailBody: 'Merchant invoice',
        llmLog: { extractedMerchant: null, extractedCategory: 'Raw Category', extractedPaymentMethod: null, extractedTransactionType: 'expense' },
        savedValues: { category: 'Shopping' },
        draftValues: { category: 'Shopping' }, // matches savedValues
        repository,
      });

      const examples = await repository.listCorrectionExamples(userId);
      expect(examples).toHaveLength(0); // must skip since it was not manually corrected
    });
  });
});

