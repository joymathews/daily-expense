import request from 'supertest';
import { app } from '../src/app';
import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';
import path from 'path';
import fs from 'fs';

describe('Fixed Charges API & Ledger Upfront Generation', () => {
  const testDbPath = path.resolve(__dirname, '../data/test_fixed_charges.db');
  let originalDatabaseUrl: string | undefined;

  beforeAll(() => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    const dataDir = path.dirname(testDbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  });

  afterAll(async () => {
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch (err) {
        // Ignore
      }
    }
  });

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch (err) {
        // Ignore
      }
    }
    process.env.DATABASE_URL = testDbPath;

    const repository = new SQLiteTransactionRepository(testDbPath);
    await repository.initializeSchema();
    await (repository as any).run("DELETE FROM fixed_charges");
    await (repository as any).run("DELETE FROM gold_transactions");
    await repository.close();
  });

  /**
   * [FUNC-ANALYSIS-5] Recurring Fixed Charges Config:
   * Verify CRUD operations on fixed charges settings templates.
   * [NFR-ANALYSIS-5] Fixed Charges CRUD Performance
   */
  it('should support adding, listing, and deleting fixed charges templates', async () => {
    // 1. Add template
    const createRes = await request(app)
      .post('/api/pipeline/fixed-charges')
      .set('Authorization', 'Bearer valid-token')
      .send({
        name: 'House Rent',
        amount: 25000,
        currency: 'INR',
        category: 'Rent',
        startDate: '2026-06-15',
        endDate: '2026-08-15',
      });

    expect(createRes.status).toBe(200);
    expect(createRes.body.status).toBe('saved');

    // 2. List templates
    const listRes = await request(app)
      .get('/api/pipeline/fixed-charges')
      .set('Authorization', 'Bearer valid-token');

    expect(listRes.status).toBe(200);
    expect(listRes.body.fixedCharges.length).toBe(1);
    expect(listRes.body.fixedCharges[0].name).toBe('House Rent');

    // 3. Delete template
    const deleteRes = await request(app)
      .delete(`/api/pipeline/fixed-charges/${listRes.body.fixedCharges[0].id}`)
      .set('Authorization', 'Bearer valid-token');

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.status).toBe('deleted');

    // Verify deleted
    const listRes2 = await request(app)
      .get('/api/pipeline/fixed-charges')
      .set('Authorization', 'Bearer valid-token');
    expect(listRes2.body.fixedCharges.length).toBe(0);
  });

  /**
   * [FUNC-ANALYSIS-6] Upfront Ledger Generation for Fixed Charges:
   * Verification that saving a template automatically creates the required ledger items of type 'fixed'.
   */
  it('should automatically generate monthly transactions in gold_transactions upon template creation', async () => {
    // 1. Create a 3-month fixed charge: June 15, July 15, August 15
    const createRes = await request(app)
      .post('/api/pipeline/fixed-charges')
      .set('Authorization', 'Bearer valid-token')
      .send({
        name: 'Car Loan EMI',
        amount: 8500,
        currency: 'INR',
        category: 'Loans',
        startDate: '2026-06-15',
        endDate: '2026-08-15',
      });
    expect(createRes.status).toBe(200);

    // 2. Fetch gold transactions to check if 3 transactions were created
    const ledgerRes = await request(app)
      .get('/api/pipeline/gold-transactions')
      .set('Authorization', 'Bearer valid-token');

    expect(ledgerRes.status).toBe(200);
    expect(ledgerRes.body.transactions.length).toBe(3);

    // Sort by date to assert
    const txs = ledgerRes.body.transactions.sort((a: any, b: any) => a.transactionDate.localeCompare(b.transactionDate));
    expect(txs[0].transactionDate).toBe('2026-06-15');
    expect(txs[1].transactionDate).toBe('2026-07-15');
    expect(txs[2].transactionDate).toBe('2026-08-15');

    // Assert details
    txs.forEach((tx: any) => {
      expect(tx.merchant).toBe('Car Loan EMI');
      expect(tx.amount).toBe(8500);
      expect(tx.currency).toBe('INR');
      expect(tx.category).toBe('Loans');
      expect(tx.transactionType).toBe('fixed');
      expect(tx.notes).toContain('Fixed Charge ID:');
    });
  });

  /**
   * [FUNC-ANALYSIS-7] Future Occurrence Syncing on Edit/Delete:
   * Verify syncing behavior when editing or deleting templates.
   */
  it('should sync changes to future occurrences while keeping past occurrences untouched on edit', async () => {
    const repository = new SQLiteTransactionRepository(testDbPath);
    await repository.initializeSchema();

    // 1. Setup a template and simulated transactions (two in the past, two in the future)
    // Assume today is 2026-06-20
    const templateId = 'temp-123';
    await repository.run(
      `INSERT INTO fixed_charges (id, user_id, name, amount, currency, category, start_date, end_date)
       VALUES (?, 'user-123', 'Gym Membership', 1000, 'INR', 'Fitness', '2026-04-25', '2026-07-25')`,
      [templateId]
    );

    // Insert 4 transactions (2 past, 2 future relative to 2026-06-20)
    // Let's adjust dates: past: 2026-04-25, 2026-05-25. Today is June 20. Future: 2026-06-25, 2026-07-25.
    await repository.run(
      `INSERT INTO gold_transactions (id, user_id, source_type, merchant, amount_cents, currency, transaction_date, category, notes, transaction_type)
       VALUES 
       ('t1', 'user-123', 'manual', 'Gym Membership', 100000, 'INR', '2026-04-25', 'Fitness', 'Fixed Charge ID: temp-123 | Gym', 'fixed'),
       ('t2', 'user-123', 'manual', 'Gym Membership', 100000, 'INR', '2026-05-25', 'Fitness', 'Fixed Charge ID: temp-123 | Gym', 'fixed'),
       ('t3', 'user-123', 'manual', 'Gym Membership', 100000, 'INR', '2026-06-25', 'Fitness', 'Fixed Charge ID: temp-123 | Gym', 'fixed'),
       ('t4', 'user-123', 'manual', 'Gym Membership', 100000, 'INR', '2026-07-25', 'Fitness', 'Fixed Charge ID: temp-123 | Gym', 'fixed')`
    );
    await repository.close();

    // 2. Modify template through API: change amount to 1200, category to 'Health', end date extended to Aug 25
    // Today is June 20, 2026.
    const editRes = await request(app)
      .post('/api/pipeline/fixed-charges')
      .set('Authorization', 'Bearer valid-token')
      .send({
        id: templateId,
        name: 'Gym Membership',
        amount: 1200,
        currency: 'INR',
        category: 'Health',
        startDate: '2026-04-25',
        endDate: '2026-08-25',
      });
    expect(editRes.status).toBe(200);

    // 3. Retrieve transactions and verify syncing
    const ledgerRes = await request(app)
      .get('/api/pipeline/gold-transactions')
      .set('Authorization', 'Bearer valid-token');

    const txs = ledgerRes.body.transactions.sort((a: any, b: any) => a.transactionDate.localeCompare(b.transactionDate));
    expect(txs.length).toBe(5); // 2 past + 2 updated future + 1 new future (Aug 25)

    // Past transactions should be UNTOUCHED (amount still 1000, category Fitness)
    expect(txs[0].transactionDate).toBe('2026-04-25');
    expect(txs[0].amount).toBe(1000);
    expect(txs[0].category).toBe('Fitness');

    expect(txs[1].transactionDate).toBe('2026-05-25');
    expect(txs[1].amount).toBe(1000);
    expect(txs[1].category).toBe('Fitness');

    // Future transactions must be UPDATED (amount 1200, category Health)
    expect(txs[2].transactionDate).toBe('2026-06-25');
    expect(txs[2].amount).toBe(1200);
    expect(txs[2].category).toBe('Health');

    expect(txs[3].transactionDate).toBe('2026-07-25');
    expect(txs[3].amount).toBe(1200);
    expect(txs[3].category).toBe('Health');

    // Extended transaction must be CREATED (Aug 25)
    expect(txs[4].transactionDate).toBe('2026-08-25');
    expect(txs[4].amount).toBe(1200);
    expect(txs[4].category).toBe('Health');
  });

  it('should delete future transactions and preserve past transactions upon template deletion', async () => {
    const repository = new SQLiteTransactionRepository(testDbPath);
    await repository.initializeSchema();

    const templateId = 'temp-delete';
    await repository.run(
      `INSERT INTO fixed_charges (id, user_id, name, amount, currency, category, start_date, end_date)
       VALUES (?, 'user-123', 'Home Rent', 20000, 'INR', 'Rent', '2026-04-01', '2026-07-01')`,
      [templateId]
    );

    // Past: 2026-04-01, 2026-05-01. Future: 2026-07-01 (relative to June 20)
    await repository.run(
      `INSERT INTO gold_transactions (id, user_id, source_type, merchant, amount_cents, currency, transaction_date, category, notes, transaction_type)
       VALUES 
       ('t1', 'user-123', 'manual', 'Home Rent', 2000000, 'INR', '2026-04-01', 'Rent', 'Fixed Charge ID: temp-delete', 'fixed'),
       ('t2', 'user-123', 'manual', 'Home Rent', 2000000, 'INR', '2026-05-01', 'Rent', 'Fixed Charge ID: temp-delete', 'fixed'),
       ('t3', 'user-123', 'manual', 'Home Rent', 2000000, 'INR', '2026-07-01', 'Rent', 'Fixed Charge ID: temp-delete', 'fixed')`
    );
    await repository.close();

    // Delete template
    const deleteRes = await request(app)
      .delete(`/api/pipeline/fixed-charges/${templateId}`)
      .set('Authorization', 'Bearer valid-token');
    expect(deleteRes.status).toBe(200);

    // Verify gold transactions
    const ledgerRes = await request(app)
      .get('/api/pipeline/gold-transactions')
      .set('Authorization', 'Bearer valid-token');

    expect(ledgerRes.body.transactions.length).toBe(2); // Only the 2 past ones remain
    const dates = ledgerRes.body.transactions.map((tx: any) => tx.transactionDate).sort();
    expect(dates).toEqual(['2026-04-01', '2026-05-01']);
  });

  /**
   * Enforce strict tenant isolation on fixed charges data
   */
  it('should enforce user data isolation on fixed charges CRUD endpoints', async () => {
    // 1. Create a template for User A
    const resA = await request(app)
      .post('/api/pipeline/fixed-charges')
      .set('Authorization', 'Bearer user-a-token')
      .send({
        name: 'Rent User A',
        amount: 15000,
        currency: 'INR',
        category: 'Rent',
        startDate: '2026-06-01',
        endDate: '2026-08-01',
      });
    expect(resA.status).toBe(200);

    // 2. Try to list templates as User B - should be empty
    const listResB = await request(app)
      .get('/api/pipeline/fixed-charges')
      .set('Authorization', 'Bearer user-b-token');
    expect(listResB.status).toBe(200);
    expect(listResB.body.fixedCharges.length).toBe(0);

    // 3. Try to delete User A's template using User B's token - should return 404/error or unauthorized
    const userATemplateId = resA.body.id || (await request(app)
      .get('/api/pipeline/fixed-charges')
      .set('Authorization', 'Bearer user-a-token')).body.fixedCharges[0].id;

    const deleteResB = await request(app)
      .delete(`/api/pipeline/fixed-charges/${userATemplateId}`)
      .set('Authorization', 'Bearer user-b-token');
    expect(deleteResB.status).toBe(404);
  });
});
