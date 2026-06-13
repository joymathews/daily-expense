import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';

describe('clear-db CLI utility regression tests', () => {
  const testDbPath = path.resolve(__dirname, '../data/test_clear_db.db');
  let repository: SQLiteTransactionRepository;

  beforeEach(async () => {
    // Clean up if database file already exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    repository = new SQLiteTransactionRepository(testDbPath);
    await repository.initializeSchema();
  });

  afterEach(async () => {
    await repository.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  /**
   * [BUG-007] Database Clearing Script Failure
   * [FUNC-SYS-2] Database Clearing Utility
   * [NFR-DB-3] Database Resettability
   * Test verifies that clear-db.js executes transactionally, does not throw SQLITE_ERROR,
   * and clears all ingestion layer tables (Bronze, Silver, Gold).
   */
  it('should clear all database tables (Bronze, Silver, Gold) successfully without error', async () => {
    // 1. Populate the test database with sample data
    const userId = 'user_test_clear';
    const emailId = 'raw_email_clear_1';
    const silverId = 'silver_clear_1';
    const goldId = 'gold_clear_1';

    // Insert into Bronze
    await repository.saveRawInput({
      id: emailId,
      userId,
      sourceType: 'email',
      sender: 'invoice@clear.com',
      title: 'Clear Invoice test',
      snippet: 'Amount $10.00',
      rawBody: 'Receipt details here',
      rawPayload: '{}',
      receivedAt: '2026-06-12T10:00:00Z',
    });

    // Insert into Silver
    await repository.savePendingTransaction({
      id: silverId,
      bronzeInputId: emailId,
      userId,
      sourceType: 'email',
      merchantRaw: 'Clear Store',
      amount: 10.00,
      currency: 'USD',
      transactionDate: '2026-06-12',
      status: 'pending',
      paymentMethod: 'UPI',
    });

    // Insert into Gold
    await repository.promoteToTransaction(silverId, {
      id: goldId,
      pendingTxId: silverId,
      userId,
      sourceType: 'email',
      merchant: 'Clear Store Inc',
      amount: 10.00,
      currency: 'USD',
      transactionDate: '2026-06-12',
      category: 'Shopping',
      paymentMethod: 'UPI',
    });

    // Verify data exists in all tables prior to clearing
    const db = new sqlite3.Database(testDbPath);
    const getCount = (query: string): Promise<number> => {
      return new Promise((resolve, reject) => {
        db.get(query, (err, row: any) => {
          if (err) reject(err);
          else resolve(row ? row.cnt : 0);
        });
      });
    };

    expect(await getCount('SELECT COUNT(*) as cnt FROM bronze_raw_inputs')).toBe(1);
    expect(await getCount('SELECT COUNT(*) as cnt FROM silver_extracted_transactions')).toBe(1);
    expect(await getCount('SELECT COUNT(*) as cnt FROM gold_transactions')).toBe(1);
    db.close();

    // 2. Run the clear-db.js script inside a child process
    const scriptPath = path.resolve(__dirname, '../../tools/clear-db.js');
    
    // Set environment variable DATABASE_URL to target the test database
    const runResult = execSync(`DATABASE_URL="${testDbPath}" node ${scriptPath}`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '../..'),
    });

    // Assert console output indicates success
    expect(runResult).toContain('Clearing table records...');
    expect(runResult).toContain('✔ Cleared gold_transactions (Gold Layer)');
    expect(runResult).toContain('✔ Cleared silver_extracted_transactions (Silver Layer)');
    expect(runResult).toContain('✔ Cleared bronze_raw_inputs (Bronze Layer)');
    expect(runResult).not.toContain('Failed to clear');
    expect(runResult).toContain('Success: All ingestion data cleared successfully!');

    // 3. Verify all tables are empty after clearing
    const dbVerify = new sqlite3.Database(testDbPath);
    const getVerifyCount = (query: string): Promise<number> => {
      return new Promise((resolve, reject) => {
        dbVerify.get(query, (err, row: any) => {
          if (err) reject(err);
          else resolve(row ? row.cnt : 0);
        });
      });
    };

    expect(await getVerifyCount('SELECT COUNT(*) as cnt FROM bronze_raw_inputs')).toBe(0);
    expect(await getVerifyCount('SELECT COUNT(*) as cnt FROM silver_extracted_transactions')).toBe(0);
    expect(await getVerifyCount('SELECT COUNT(*) as cnt FROM gold_transactions')).toBe(0);
    dbVerify.close();
  });
});
