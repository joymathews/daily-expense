import request from 'supertest';
import { app } from '../src/app';
import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

describe('LLM Accuracy Ingestion and Metrics API [FUNC-GMAIL-40]', () => {
  const userId = 'user-123';
  const token = 'valid-token';
  const testDbPath = path.resolve(__dirname, '../data/test_accuracy.db');
  let repository: SQLiteTransactionRepository;

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    process.env.DATABASE_URL = testDbPath;
    repository = new SQLiteTransactionRepository(testDbPath);
    await repository.initializeSchema();
  });

  afterEach(async () => {
    await repository.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('performs double writes to staging and LLM extraction log upon saving pending transaction [FUNC-GMAIL-40]', async () => {
    const rawInputId = 'raw_id_101';
    await repository.saveRawInput({
      id: rawInputId,
      userId,
      sourceType: 'email',
      sender: 'store@merchant.com',
      title: 'Billing Receipt',
      snippet: 'Paid $10',
      rawBody: 'Receipt details for Merchant A, amount 10.00 USD, paid via UPI.',
      rawPayload: '{}',
      receivedAt: new Date().toISOString(),
      hasTransaction: true,
      status: 'unprocessed'
    });

    const pendingTxId = crypto.randomUUID();
    await repository.savePendingTransaction({
      id: pendingTxId,
      bronzeInputId: rawInputId,
      userId,
      sourceType: 'email',
      merchantRaw: 'Merchant A',
      merchantNormalized: 'Merchant A',
      amount: 10.00,
      currency: 'USD',
      transactionDate: '2026-06-12',
      inferredCategory: 'Shopping',
      confidenceScore: 0.95,
      status: 'pending',
      paymentMethod: 'UPI',
      transactionType: 'expense'
    });

    // 1. Verify staging was saved
    const stagingRecord = await repository.getSilverTransactionById(pendingTxId, userId);
    expect(stagingRecord).toBeDefined();
    expect(stagingRecord?.merchantRaw).toBe('Merchant A');

    // 2. Verify audit log was saved
    const llmLog = await repository.getLlmExtractionLogByBronzeId(rawInputId, userId);
    expect(llmLog).not.toBeNull();
    expect(llmLog.extractedMerchant).toBe('Merchant A');
    expect(llmLog.extractedAmount).toBe(10.00);
    expect(llmLog.extractedPaymentMethod).toBe('UPI');
  });

  it('calculates LLM accuracy stats and exposes them via REST API [FUNC-GOLD-PAGE-9] [FUNC-GOLD-PAGE-10]', async () => {
    const rawIdMatch = 'raw_match';
    const rawIdDiff = 'raw_diff';

    await repository.saveRawInput({
      id: rawIdMatch,
      userId,
      sourceType: 'email',
      sender: 'billing@test.com',
      title: 'Invoice 1',
      snippet: 'Paid $100',
      rawBody: 'Receipt details...',
      rawPayload: '{}',
      receivedAt: '2026-06-12T10:00:00Z',
      hasTransaction: true,
      status: 'unprocessed'
    });

    await repository.saveRawInput({
      id: rawIdDiff,
      userId,
      sourceType: 'email',
      sender: 'billing@test.com',
      title: 'Invoice 2',
      snippet: 'Paid $200',
      rawBody: 'Receipt details...',
      rawPayload: '{}',
      receivedAt: '2026-06-12T11:00:00Z',
      hasTransaction: true,
      status: 'unprocessed'
    });

    const silverIdMatch = 'silver_match';
    const silverIdDiff = 'silver_diff';

    // Matches exactly: Merchant A, 100.00 USD, Shopping, UPI
    await repository.savePendingTransaction({
      id: silverIdMatch,
      bronzeInputId: rawIdMatch,
      userId,
      sourceType: 'email',
      merchantRaw: 'Merchant A',
      merchantNormalized: 'Merchant A',
      amount: 100.00,
      currency: 'USD',
      transactionDate: '2026-06-12',
      inferredCategory: 'Shopping',
      confidenceScore: 0.9,
      status: 'pending',
      paymentMethod: 'UPI',
      transactionType: 'expense'
    });

    // Differs (User corrected merchant and category later)
    await repository.savePendingTransaction({
      id: silverIdDiff,
      bronzeInputId: rawIdDiff,
      userId,
      sourceType: 'email',
      merchantRaw: 'Merchant B Raw',
      merchantNormalized: 'Merchant B Raw',
      amount: 200.00,
      currency: 'USD',
      transactionDate: '2026-06-12',
      inferredCategory: 'Shopping',
      confidenceScore: 0.85,
      status: 'pending',
      paymentMethod: 'UPI',
      transactionType: 'expense'
    });

    const goldIdMatch = 'gold_match';
    const goldIdDiff = 'gold_diff';

    // Match entry: matches LLM logs exactly
    await repository.promoteToTransaction(silverIdMatch, {
      id: goldIdMatch,
      pendingTxId: silverIdMatch,
      userId,
      sourceType: 'email',
      merchant: 'Merchant A',
      amount: 100.00,
      currency: 'USD',
      transactionDate: '2026-06-12',
      category: 'Shopping',
      paymentMethod: 'UPI',
      transactionType: 'expense'
    });

    // Diff entry: corrected merchant and category
    await repository.promoteToTransaction(silverIdDiff, {
      id: goldIdDiff,
      pendingTxId: silverIdDiff,
      userId,
      sourceType: 'email',
      merchant: 'Merchant B Corrected',
      amount: 200.00,
      currency: 'USD',
      transactionDate: '2026-06-12',
      category: 'Food',
      paymentMethod: 'UPI',
      transactionType: 'expense'
    });

    // Test GET /api/pipeline/llm-accuracy-stats
    const statsRes = await request(app)
      .get('/api/pipeline/llm-accuracy-stats')
      .set('Authorization', `Bearer ${token}`);

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.stats).toBeDefined();
    expect(statsRes.body.stats.totalTested).toBe(2);
    expect(statsRes.body.stats.merchantAccuracy).toBe(50);
    expect(statsRes.body.stats.amountAccuracy).toBe(100);
    expect(statsRes.body.stats.categoryAccuracy).toBe(50);
    expect(statsRes.body.stats.overallAccuracy).toBe(75);

    // Test GET /api/pipeline/llm-logs/:bronzeInputId
    const logRes = await request(app)
      .get(`/api/pipeline/llm-logs/${rawIdMatch}`)
      .set('Authorization', `Bearer ${token}`);

    expect(logRes.status).toBe(200);
    expect(logRes.body.log).toBeDefined();
    expect(logRes.body.log.extractedMerchant).toBe('Merchant A');
    expect(logRes.body.log.extractedAmount).toBe(100.00);
    expect(logRes.body.log.extractedPaymentMethod).toBe('UPI');
  });
});
