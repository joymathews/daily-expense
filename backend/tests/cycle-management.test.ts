import request from 'supertest';
import { app } from '../src/app';
import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';
import { generateDefaultCycles, buildUserCycleList } from '../src/services/cycle-engine';
import path from 'path';
import fs from 'fs';

describe('Dynamic Cycle Management & Cycle Engine [FUNC-CYCLE-1] [FUNC-CYCLE-2] [FUNC-CYCLE-3] [FUNC-CYCLE-4] [NFR-CYCLE-1] [NFR-CYCLE-2] [NFR-CYCLE-3]', () => {
  const testDbPath = path.resolve(__dirname, '../data/test_cycle_mgmt.db');
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
    const repo = new SQLiteTransactionRepository();
    await repo.initializeSchema();
    await repo.close();
  });

  describe('Cycle Engine Pure Logic', () => {
    it('generates default recurring cycles anchored to 17th of the month [FUNC-CYCLE-1]', () => {
      const refDate = new Date('2026-06-20T12:00:00Z');
      const defaultCycles = generateDefaultCycles(17, refDate);

      expect(defaultCycles.length).toBeGreaterThan(0);
      const juneCycle = defaultCycles.find(c => c.startDate === '2026-06-17');
      expect(juneCycle).toBeDefined();
      expect(juneCycle?.endDate).toBe('2026-07-16');
    });

    it('builds dynamic cycle list overlaying custom start date override and chaining boundaries [FUNC-CYCLE-1, FUNC-CYCLE-2]', () => {
      const refDate = new Date('2026-07-05T12:00:00Z');
      const overrides = [
        {
          id: 'ov-jun-28',
          userId: 'test-user',
          startType: 'date' as const,
          startDate: '2026-06-28',
          startTimestamp: '2026-06-28T00:00:00.000Z',
        },
      ];

      const cycles = buildUserCycleList(17, overrides, refDate);
      expect(cycles.length).toBeGreaterThan(0);

      // Current active cycle (July)
      const currentCycle = cycles.find(c => c.isCurrent);
      expect(currentCycle).toBeDefined();
      expect(currentCycle?.startDate).toBe('2026-06-28');
      expect(currentCycle?.endDate).toBeNull(); // Active cycle open-ended

      // Previous cycle (May) should end 1ms before June 28th
      const mayCycle = cycles.find(c => c.startDate === '2026-05-17');
      expect(mayCycle).toBeDefined();
      expect(mayCycle?.endDate).toBe('2026-06-27');
    });

    it('handles intra-day timestamps for transaction-anchored overrides [FUNC-CYCLE-3]', () => {
      const refDate = new Date('2026-07-05T12:00:00Z');
      const overrides = [
        {
          id: 'ov-salary-txn',
          userId: 'test-user',
          startType: 'transaction' as const,
          startTransactionId: 'gold-tx-salary-101',
          startDate: '2026-06-28',
          startTimestamp: '2026-06-28T11:00:00.000Z', // Payday 11:00 AM
        },
      ];

      const cycles = buildUserCycleList(17, overrides, refDate);
      const activeCycle = cycles.find(c => c.isCurrent);
      expect(activeCycle?.startTimestamp).toBe('2026-06-28T11:00:00.000Z');

      const mayCycle = cycles.find(c => c.startDate === '2026-05-17');
      expect(mayCycle?.endTimestamp).toBe('2026-06-28T10:59:59.999Z');
    });
  });

  describe('Database Schema & Repository Integration', () => {
    it('migrates gold_transactions schema with source_received_at and backfills from bronze_raw_inputs [FUNC-CYCLE-3]', async () => {
      const repository = new SQLiteTransactionRepository();
      await repository.initializeSchema();

      // Insert bronze raw input with email timestamp
      await (repository as any).run(
        `INSERT INTO bronze_raw_inputs (id, user_id, source_type, sender, title, raw_body, received_at)
         VALUES ('b-1', 'user-1', 'email', 'bank@hdfc.com', 'Salary Credited', 'Body', '2026-06-28T11:00:00.000Z')`
      );

      // Insert silver extracted transaction
      await (repository as any).run(
        `INSERT INTO silver_extracted_transactions (id, user_id, bronze_input_id, source_type, merchant_raw, amount_cents, currency, transaction_date)
         VALUES ('s-1', 'user-1', 'b-1', 'email', 'ACME Corp', 10000000, 'INR', '2026-06-28')`
      );

      // Insert gold transaction with silver_tx_id
      await (repository as any).run(
        `INSERT INTO gold_transactions (id, silver_tx_id, user_id, source_type, merchant, amount_cents, currency, transaction_date, category, source_received_at)
         VALUES ('g-1', 's-1', 'user-1', 'email', 'ACME Corp', 10000000, 'INR', '2026-06-28', 'Income', '2026-06-28T11:00:00.000Z')`
      );

      const goldTxs = await repository.getGoldTransactions('user-1');
      expect(goldTxs.length).toBe(1);
      expect(goldTxs[0].sourceReceivedAt).toBe('2026-06-28T11:00:00.000Z');

      await repository.close();
    });

    it('persists and retrieves user cycle overrides [FUNC-CYCLE-1, NFR-CYCLE-3]', async () => {
      const repository = new SQLiteTransactionRepository();
      await repository.initializeSchema();

      await repository.upsertCycleOverride('user-1', {
        id: 'override-1',
        userId: 'user-1',
        startType: 'transaction',
        startTransactionId: 'g-1',
        startDate: '2026-06-28',
        startTimestamp: '2026-06-28T11:00:00.000Z',
      });

      const overrides = await repository.getCycleOverrides('user-1');
      expect(overrides.length).toBe(1);
      expect(overrides[0].startType).toBe('transaction');
      expect(overrides[0].startTransactionId).toBe('g-1');

      const isAnchor = await repository.isCycleStartAnchor('user-1', 'g-1');
      expect(isAnchor).toBe(true);

      await repository.close();
    });
  });

  describe('API Endpoints for Cycle Overrides', () => {
    it('GET /api/pipeline/user-cycles returns calculated cycle list [FUNC-CYCLE-5, NFR-CYCLE-1]', async () => {
      const res = await request(app)
        .get('/api/pipeline/user-cycles')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(res.body).toHaveProperty('cycles');
      expect(Array.isArray(res.body.cycles)).toBe(true);
      expect(res.body.cycles.length).toBeGreaterThan(0);
      expect(res.body).toHaveProperty('activeCycle');
    });

    it('POST /api/pipeline/user-cycles/override sets a cycle start override [FUNC-CYCLE-1, NFR-CYCLE-3]', async () => {
      const payload = {
        startType: 'date',
        startDate: '2026-06-25',
        startTimestamp: '2026-06-25T00:00:00.000Z',
      };

      const res = await request(app)
        .post('/api/pipeline/user-cycles/override')
        .set('Authorization', 'Bearer valid-token')
        .send(payload)
        .expect(200);

      expect(res.body.status).toBe('updated');
      expect(res.body.cycles).toBeDefined();

      const getRes = await request(app)
        .get('/api/pipeline/user-cycles')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      const juneCycle = getRes.body.cycles.find((c: any) => c.startDate === '2026-06-25');
      expect(juneCycle).toBeDefined();
    });

    it('DELETE /api/pipeline/user-cycles/override/:id resets cycle back to default [FUNC-CYCLE-2]', async () => {
      // First add override
      await request(app)
        .post('/api/pipeline/user-cycles/override')
        .set('Authorization', 'Bearer valid-token')
        .send({
          startType: 'date',
          startDate: '2026-06-25',
          startTimestamp: '2026-06-25T00:00:00.000Z',
        })
        .expect(200);

      // Delete override
      await request(app)
        .delete('/api/pipeline/user-cycles/override/default-2026-06-25')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      const getRes = await request(app)
        .get('/api/pipeline/user-cycles')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      const overrideCycle = getRes.body.cycles.find((c: any) => c.startDate === '2026-06-25' && c.startType !== 'default');
      expect(overrideCycle).toBeUndefined();
    });
  });
});

