import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';
import pipelineRoutes from '../src/routes/pipeline-routes';

describe('Pipeline Summary Stats Endpoint [FUNC-PIPE-STATS-1] [NFR-PERF-12]', () => {
  const testDbPath = path.resolve(__dirname, '../data/test_summary_stats.db');
  let originalDatabaseUrl: string | undefined;
  let app: express.Application;
  let repository: SQLiteTransactionRepository;
  const testUserId = 'test_perf_user_1';

  beforeAll(() => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    const dataDir = path.dirname(testDbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  });

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    process.env.DATABASE_URL = testDbPath;
    repository = new SQLiteTransactionRepository(testDbPath);
    await repository.initializeSchema();

    app = express();
    app.use(express.json());
    // Mock authentication middleware
    app.use((req, res, next) => {
      (req as any).auth = { sub: testUserId };
      next();
    });
    app.use('/api/pipeline', pipelineRoutes);
  });

  afterEach(async () => {
    await repository.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterAll(() => {
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  it('aggregates bronze, silver, and gold counts without sending raw payload blobs [FUNC-PIPE-STATS-1] [NFR-PERF-12]', async () => {
    // 1. Insert Bronze inputs
    await repository.saveRawInput({
      id: 'raw_1',
      userId: testUserId,
      sourceType: 'email',
      sender: 'bank@test.com',
      title: 'Alert 1',
      snippet: 'Debit 100',
      rawBody: 'Full raw email body with large content...',
      rawPayload: '{}',
      receivedAt: '2026-03-01T10:00:00Z',
      hasTransaction: true,
      status: 'unprocessed',
    });

    await repository.saveRawInput({
      id: 'raw_2',
      userId: testUserId,
      sourceType: 'email',
      sender: 'bank@test.com',
      title: 'Alert 2',
      snippet: 'Debit 200',
      rawBody: 'Full raw email body with large content 2...',
      rawPayload: '{}',
      receivedAt: '2026-03-02T10:00:00Z',
      hasTransaction: true,
      status: 'processed',
    });

    await repository.saveRawInput({
      id: 'raw_3',
      userId: testUserId,
      sourceType: 'email',
      sender: 'promo@test.com',
      title: 'Promo 1',
      snippet: 'No transaction',
      rawBody: 'Promo content...',
      rawPayload: '{}',
      receivedAt: '2026-03-03T10:00:00Z',
      hasTransaction: false,
      status: 'rejected',
    });

    await repository.saveRawInput({
      id: 'raw_4',
      userId: testUserId,
      sourceType: 'email',
      sender: 'bank3@test.com',
      title: 'Alert 3',
      snippet: 'Pending extraction',
      rawBody: 'Content...',
      rawPayload: '{}',
      receivedAt: '2026-03-04T10:00:00Z',
      hasTransaction: true,
      status: 'unprocessed',
    });

    // 2. Insert Silver staging transactions
    await repository.savePendingTransaction({
      id: 'silver_1',
      bronzeInputId: 'raw_1',
      userId: testUserId,
      sourceType: 'email',
      merchantRaw: 'Amazon',
      amount: 100,
      currency: 'INR',
      transactionDate: '2026-03-01',
      paymentMethod: 'UPI',
      status: 'pending',
    });

    await repository.savePendingTransaction({
      id: 'silver_2',
      bronzeInputId: 'raw_2',
      userId: testUserId,
      sourceType: 'email',
      merchantRaw: 'Unknown',
      amount: 50,
      currency: 'INR',
      transactionDate: '2026-03-03',
      paymentMethod: 'UPI',
      status: 'pending',
    });

    // Explicitly reject silver_2 and raw_3
    await repository.updatePendingTransaction('silver_2', testUserId, { status: 'rejected' });
    await repository.rejectRawInput('raw_3', testUserId);

    // 3. Insert Gold confirmed transactions (including refund and expense)
    await repository.addDirectGoldTransaction({
      id: 'gold_1',
      userId: testUserId,
      sourceType: 'email',
      merchant: 'Supermarket',
      amount: 500,
      currency: 'INR',
      transactionDate: '2026-03-05',
      category: 'Groceries',
      paymentMethod: 'UPI',
      transactionType: 'expense',
    });

    await repository.addDirectGoldTransaction({
      id: 'gold_2',
      userId: testUserId,
      sourceType: 'manual',
      merchant: 'Return Item',
      amount: 100,
      currency: 'INR',
      transactionDate: '2026-03-06',
      category: 'Shopping',
      paymentMethod: 'UPI',
      transactionType: 'refund',
    });

    // User isolation check: insert records for another user
    await repository.addDirectGoldTransaction({
      id: 'gold_other',
      userId: 'other_user',
      sourceType: 'manual',
      merchant: 'Other Merchant',
      amount: 10000,
      currency: 'INR',
      transactionDate: '2026-03-05',
      category: 'Shopping',
      paymentMethod: 'UPI',
      transactionType: 'expense',
    });

    const res = await request(app).get('/api/pipeline/summary-stats');
    expect(res.status).toBe(200);
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats).toEqual({
      bronzeCount: 4,
      bronzeProcessedCount: 2,
      bronzeUnprocessedCount: 1,
      bronzeRejectedCount: 1,
      silverCount: 1,
      silverRejectedCount: 1,
      goldCount: 2,
      goldTotalAmount: 400, // 500 expense - 100 refund
    });
  });
});
