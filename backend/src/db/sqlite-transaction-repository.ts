import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { ITransactionRepository, RawEmail, PendingTransaction, Transaction } from './transaction-repository';

export class SQLiteTransactionRepository implements ITransactionRepository {
  private db: sqlite3.Database;

  constructor(dbPath: string = process.env.DATABASE_URL || './data/daily_expense.db') {
    if (dbPath === ':memory:') {
      this.db = new sqlite3.Database(dbPath);
      return;
    }

    // Resolve absolute path and ensure the parent directory exists
    const resolvedPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
    const parentDir = path.dirname(resolvedPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    this.db = new sqlite3.Database(resolvedPath);
  }

  // Wrap runs/queries in Promise utilities for clean async/await code
  private run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as T);
      });
    });
  }

  private all<T>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  async initializeSchema(): Promise<void> {
    // Enable Foreign Key support in SQLite session
    await this.run('PRAGMA foreign_keys = ON;');

    // Dynamic Migration check: check if user_id exists in bronze_raw_emails or payment_method in silver_extracted_transactions
    const info = await this.all<{ name: string }>("PRAGMA table_info(bronze_raw_emails);");
    const hasUserId = info.some(col => col.name === 'user_id');
    const silverInfo = await this.all<{ name: string }>("PRAGMA table_info(silver_extracted_transactions);");
    const hasPaymentMethod = silverInfo.some(col => col.name === 'payment_method');

    if ((info.length > 0 && !hasUserId) || (silverInfo.length > 0 && !hasPaymentMethod)) {
      await this.run('DROP TABLE IF EXISTS gold_transactions;');
      await this.run('DROP TABLE IF EXISTS silver_extracted_transactions;');
      await this.run('DROP TABLE IF EXISTS bronze_raw_emails;');
    }

    // 1. Bronze table: Raw Ingestion
    await this.run(`
      CREATE TABLE IF NOT EXISTS bronze_raw_emails (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        subject TEXT NOT NULL,
        snippet TEXT,
        raw_body TEXT NOT NULL,
        raw_payload TEXT,
        received_at TEXT NOT NULL,
        ingested_at TEXT DEFAULT (datetime('now', 'utc')),
        PRIMARY KEY (user_id, id)
      );
    `);

    // 2. Silver table: Staging Area
    await this.run(`
      CREATE TABLE IF NOT EXISTS silver_extracted_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        bronze_email_id TEXT NOT NULL,
        merchant_raw TEXT NOT NULL,
        merchant_normalized TEXT,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        transaction_date TEXT NOT NULL,
        inferred_category TEXT,
        confidence_score REAL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        payment_method TEXT,
        extracted_at TEXT DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (user_id, bronze_email_id) REFERENCES bronze_raw_emails(user_id, id) ON DELETE CASCADE,
        UNIQUE(user_id, bronze_email_id),
        UNIQUE(user_id, id)
      );
    `);

    // 3. Gold table: Confirmed Ledger
    await this.run(`
      CREATE TABLE IF NOT EXISTS gold_transactions (
        id TEXT PRIMARY KEY,
        silver_tx_id TEXT UNIQUE,
        user_id TEXT NOT NULL,
        merchant TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        transaction_date TEXT NOT NULL,
        category TEXT NOT NULL,
        notes TEXT,
        payment_method TEXT,
        created_at TEXT DEFAULT (datetime('now', 'utc')),
        updated_at TEXT DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (user_id, silver_tx_id) REFERENCES silver_extracted_transactions(user_id, id) ON DELETE SET NULL
      );
    `);

    // 4. Create Indexes
    await this.run('CREATE INDEX IF NOT EXISTS idx_bronze_emails_sender ON bronze_raw_emails(sender);');
    await this.run('CREATE INDEX IF NOT EXISTS idx_silver_tx_status ON silver_extracted_transactions(status);');
    await this.run('CREATE INDEX IF NOT EXISTS idx_gold_tx_user_date ON gold_transactions(user_id, transaction_date);');
  }

  async emailExists(gmailId: string, userId: string): Promise<boolean> {
    const row = await this.get<{ id: string }>('SELECT id FROM bronze_raw_emails WHERE id = ? AND user_id = ?', [gmailId, userId]);
    return !!row;
  }

  async saveRawEmail(email: RawEmail): Promise<void> {
    await this.run(
      `INSERT OR IGNORE INTO bronze_raw_emails 
       (id, user_id, sender, subject, snippet, raw_body, raw_payload, received_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        email.id,
        email.userId,
        email.sender,
        email.subject,
        email.snippet,
        email.rawBody,
        email.rawPayload,
        email.receivedAt,
      ]
    );
  }

  async savePendingTransaction(tx: PendingTransaction): Promise<void> {
    const amountCents = Math.round(tx.amount * 100);
    await this.run(
      `INSERT OR IGNORE INTO silver_extracted_transactions 
       (id, user_id, bronze_email_id, merchant_raw, merchant_normalized, amount_cents, currency, transaction_date, inferred_category, confidence_score, status, payment_method) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tx.id,
        tx.userId,
        tx.rawEmailId,
        tx.merchantRaw,
        tx.merchantNormalized || null,
        amountCents,
        tx.currency,
        tx.transactionDate,
        tx.inferredCategory || null,
        tx.confidenceScore ?? null,
        tx.status,
        tx.paymentMethod || null,
      ]
    );
  }

  async getPendingTransactions(userId: string): Promise<PendingTransaction[]> {
    const rows = await this.all<any>(
      `SELECT * FROM silver_extracted_transactions WHERE status = 'pending' AND user_id = ?`,
      [userId]
    );

    return rows.map(row => ({
      id: row.id,
      rawEmailId: row.bronze_email_id,
      userId: row.user_id,
      merchantRaw: row.merchant_raw,
      merchantNormalized: row.merchant_normalized || undefined,
      amount: row.amount_cents / 100, // Convert cents to standard currency float
      currency: row.currency,
      transactionDate: row.transaction_date,
      inferredCategory: row.inferred_category || undefined,
      confidenceScore: row.confidence_score ?? undefined,
      status: row.status as 'pending' | 'approved' | 'rejected',
      extractedAt: row.extracted_at,
      paymentMethod: row.payment_method || undefined,
    }));
  }

  async promoteToTransaction(pendingId: string, tx: Transaction): Promise<void> {
    const amountCents = Math.round(tx.amount * 100);

    // Run promotions in an ACID Transaction Block
    await this.run('BEGIN TRANSACTION');
    try {
      // 1. Update status in silver staging table only if user matches
      await this.run(
        `UPDATE silver_extracted_transactions SET status = 'approved' WHERE id = ? AND user_id = ?`,
        [pendingId, tx.userId]
      );

      // 2. Insert validated transaction in gold ledger table
      await this.run(
        `INSERT OR IGNORE INTO gold_transactions 
         (id, silver_tx_id, user_id, merchant, amount_cents, currency, transaction_date, category, notes, payment_method) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tx.id,
          pendingId,
          tx.userId,
          tx.merchant,
          amountCents,
          tx.currency,
          tx.transactionDate,
          tx.category,
          tx.notes || null,
          tx.paymentMethod || null,
        ]
      );

      await this.run('COMMIT');
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
  }

  async getRawEmails(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<RawEmail[]> {
    let sql = 'SELECT * FROM bronze_raw_emails WHERE user_id = ?';
    const params: any[] = [userId];
    if (filters?.startDate) {
      sql += ' AND date(received_at) >= date(?)';
      params.push(filters.startDate);
    }
    if (filters?.endDate) {
      sql += ' AND date(received_at) <= date(?)';
      params.push(filters.endDate);
    }
    sql += ' ORDER BY received_at DESC';
    const rows = await this.all<any>(sql, params);
    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      sender: row.sender,
      subject: row.subject,
      snippet: row.snippet || '',
      rawBody: row.raw_body,
      rawPayload: row.raw_payload || '',
      receivedAt: row.received_at,
      ingestedAt: row.ingested_at,
    }));
  }

  async getRawEmailById(id: string, userId: string): Promise<RawEmail | undefined> {
    const row = await this.get<any>('SELECT * FROM bronze_raw_emails WHERE id = ? AND user_id = ?', [id, userId]);
    if (!row) return undefined;
    return {
      id: row.id,
      userId: row.user_id,
      sender: row.sender,
      subject: row.subject,
      snippet: row.snippet || '',
      rawBody: row.raw_body,
      rawPayload: row.raw_payload || '',
      receivedAt: row.received_at,
      ingestedAt: row.ingested_at,
    };
  }

  async getSilverTransactions(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<PendingTransaction[]> {
    let sql = `
      SELECT s.*, b.subject AS email_subject, b.sender AS email_sender, b.received_at AS email_received_at
      FROM silver_extracted_transactions s
      LEFT JOIN bronze_raw_emails b ON s.bronze_email_id = b.id AND s.user_id = b.user_id
      WHERE s.user_id = ?
    `;
    const params: any[] = [userId];
    if (filters?.startDate) {
      sql += ' AND date(s.transaction_date) >= date(?)';
      params.push(filters.startDate);
    }
    if (filters?.endDate) {
      sql += ' AND date(s.transaction_date) <= date(?)';
      params.push(filters.endDate);
    }
    sql += ' ORDER BY s.transaction_date DESC';
    const rows = await this.all<any>(sql, params);
    return rows.map(row => ({
      id: row.id,
      rawEmailId: row.bronze_email_id,
      userId: row.user_id,
      merchantRaw: row.merchant_raw,
      merchantNormalized: row.merchant_normalized || undefined,
      amount: row.amount_cents / 100,
      currency: row.currency,
      transactionDate: row.transaction_date,
      inferredCategory: row.inferred_category || undefined,
      confidenceScore: row.confidence_score ?? undefined,
      status: row.status as 'pending' | 'approved' | 'rejected',
      extractedAt: row.extracted_at,
      emailSubject: row.email_subject || undefined,
      emailSender: row.email_sender || undefined,
      emailReceivedAt: row.email_received_at || undefined,
      paymentMethod: row.payment_method || undefined,
    }));
  }

  async getSilverTransactionByEmailId(emailId: string, userId: string): Promise<PendingTransaction | undefined> {
    const row = await this.get<any>(
      `SELECT s.*, b.subject AS email_subject, b.sender AS email_sender, b.received_at AS email_received_at
       FROM silver_extracted_transactions s
       LEFT JOIN bronze_raw_emails b ON s.bronze_email_id = b.id AND s.user_id = b.user_id
       WHERE s.bronze_email_id = ? AND s.user_id = ?`,
      [emailId, userId]
    );
    if (!row) return undefined;
    return {
      id: row.id,
      rawEmailId: row.bronze_email_id,
      userId: row.user_id,
      merchantRaw: row.merchant_raw,
      merchantNormalized: row.merchant_normalized || undefined,
      amount: row.amount_cents / 100,
      currency: row.currency,
      transactionDate: row.transaction_date,
      inferredCategory: row.inferred_category || undefined,
      confidenceScore: row.confidence_score ?? undefined,
      status: row.status as 'pending' | 'approved' | 'rejected',
      extractedAt: row.extracted_at,
      emailSubject: row.email_subject || undefined,
      emailSender: row.email_sender || undefined,
      emailReceivedAt: row.email_received_at || undefined,
      paymentMethod: row.payment_method || undefined,
    };
  }

  async getSilverTransactionById(id: string, userId: string): Promise<PendingTransaction | undefined> {
    const row = await this.get<any>(
      `SELECT s.*, b.subject AS email_subject, b.sender AS email_sender, b.received_at AS email_received_at
       FROM silver_extracted_transactions s
       LEFT JOIN bronze_raw_emails b ON s.bronze_email_id = b.id AND s.user_id = b.user_id
       WHERE s.id = ? AND s.user_id = ?`,
      [id, userId]
    );
    if (!row) return undefined;
    return {
      id: row.id,
      rawEmailId: row.bronze_email_id,
      userId: row.user_id,
      merchantRaw: row.merchant_raw,
      merchantNormalized: row.merchant_normalized || undefined,
      amount: row.amount_cents / 100,
      currency: row.currency,
      transactionDate: row.transaction_date,
      inferredCategory: row.inferred_category || undefined,
      confidenceScore: row.confidence_score ?? undefined,
      status: row.status as 'pending' | 'approved' | 'rejected',
      extractedAt: row.extracted_at,
      emailSubject: row.email_subject || undefined,
      emailSender: row.email_sender || undefined,
      emailReceivedAt: row.email_received_at || undefined,
      paymentMethod: row.payment_method || undefined,
    };
  }

  async getGoldTransactions(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<Transaction[]> {
    let sql = `
      SELECT g.*, s.bronze_email_id, b.subject AS email_subject, b.sender AS email_sender, b.received_at AS email_received_at
      FROM gold_transactions g
      LEFT JOIN silver_extracted_transactions s ON g.silver_tx_id = s.id AND g.user_id = s.user_id
      LEFT JOIN bronze_raw_emails b ON s.bronze_email_id = b.id AND g.user_id = b.user_id
      WHERE g.user_id = ?
    `;
    const params: any[] = [userId];
    if (filters?.startDate) {
      sql += ' AND date(g.transaction_date) >= date(?)';
      params.push(filters.startDate);
    }
    if (filters?.endDate) {
      sql += ' AND date(g.transaction_date) <= date(?)';
      params.push(filters.endDate);
    }
    sql += ' ORDER BY g.transaction_date DESC';
    const rows = await this.all<any>(sql, params);
    return rows.map(row => ({
      id: row.id,
      pendingTxId: row.silver_tx_id || undefined,
      userId: row.user_id,
      merchant: row.merchant,
      amount: row.amount_cents / 100,
      currency: row.currency,
      transactionDate: row.transaction_date,
      category: row.category,
      notes: row.notes || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      emailSubject: row.email_subject || undefined,
      emailSender: row.email_sender || undefined,
      emailReceivedAt: row.email_received_at || undefined,
      bronzeEmailId: row.bronze_email_id || undefined,
      paymentMethod: row.payment_method || undefined,
    }));
  }

  async updateGoldTransaction(id: string, userId: string, updates: Partial<Transaction>): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.merchant !== undefined) {
      sets.push('merchant = ?');
      params.push(updates.merchant);
    }
    if (updates.amount !== undefined) {
      sets.push('amount_cents = ?');
      params.push(Math.round(updates.amount * 100));
    }
    if (updates.currency !== undefined) {
      sets.push('currency = ?');
      params.push(updates.currency);
    }
    if (updates.transactionDate !== undefined) {
      sets.push('transaction_date = ?');
      params.push(updates.transactionDate);
    }
    if (updates.category !== undefined) {
      sets.push('category = ?');
      params.push(updates.category);
    }
    if (updates.notes !== undefined) {
      sets.push('notes = ?');
      params.push(updates.notes);
    }
    if (updates.paymentMethod !== undefined) {
      sets.push('payment_method = ?');
      params.push(updates.paymentMethod);
    }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now', 'utc')");
    params.push(id);
    params.push(userId);
    await this.run(`UPDATE gold_transactions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params);
  }

  async updatePendingTransaction(id: string, userId: string, updates: Partial<PendingTransaction>): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.merchantRaw !== undefined) {
      sets.push('merchant_raw = ?');
      params.push(updates.merchantRaw);
    }
    if (updates.merchantNormalized !== undefined) {
      sets.push('merchant_normalized = ?');
      params.push(updates.merchantNormalized);
    }
    if (updates.amount !== undefined) {
      sets.push('amount_cents = ?');
      params.push(Math.round(updates.amount * 100));
    }
    if (updates.currency !== undefined) {
      sets.push('currency = ?');
      params.push(updates.currency);
    }
    if (updates.transactionDate !== undefined) {
      sets.push('transaction_date = ?');
      params.push(updates.transactionDate);
    }
    if (updates.inferredCategory !== undefined) {
      sets.push('inferred_category = ?');
      params.push(updates.inferredCategory);
    }
    if (updates.status !== undefined) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.paymentMethod !== undefined) {
      sets.push('payment_method = ?');
      params.push(updates.paymentMethod);
    }
    if (sets.length === 0) return;
    params.push(id);
    params.push(userId);
    await this.run(`UPDATE silver_extracted_transactions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params);
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close(err => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
