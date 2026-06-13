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

    // Dynamic Migration check: check if user_id and has_transaction exist in bronze_raw_emails or payment_method in silver_extracted_transactions
    const info = await this.all<{ name: string }>("PRAGMA table_info(bronze_raw_emails);");
    const hasUserId = info.some(col => col.name === 'user_id');
    const hasHasTransaction = info.some(col => col.name === 'has_transaction');
    const silverInfo = await this.all<{ name: string }>("PRAGMA table_info(silver_extracted_transactions);");
    const hasPaymentMethod = silverInfo.some(col => col.name === 'payment_method');
    
    // Check if current silver table constraint contains 'error'
    const schemaSql = await this.get<{ sql?: string }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='silver_extracted_transactions'"
    );
    const hasErrorStatus = schemaSql?.sql?.includes("'error'") ?? false;

    if (
      (info.length > 0 && (!hasUserId || !hasHasTransaction)) ||
      (silverInfo.length > 0 && (!hasPaymentMethod || !hasErrorStatus))
    ) {
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
        has_transaction INTEGER NOT NULL DEFAULT 1,
        ingested_at TEXT DEFAULT (datetime('now', 'utc')),
        deleted_at TEXT,
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
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'error')),
        payment_method TEXT,
        deleted_at TEXT,
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
        deleted_at TEXT,
        created_at TEXT DEFAULT (datetime('now', 'utc')),
        updated_at TEXT DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (user_id, silver_tx_id) REFERENCES silver_extracted_transactions(user_id, id) ON DELETE SET NULL
      );
    `);

    // Dynamic migrations for deleted_at column
    const bronzeInfo = await this.all<{ name: string }>("PRAGMA table_info(bronze_raw_emails);");
    if (bronzeInfo.length > 0 && !bronzeInfo.some(col => col.name === 'deleted_at')) {
      await this.run("ALTER TABLE bronze_raw_emails ADD COLUMN deleted_at TEXT;");
    }

    const silverInfo2 = await this.all<{ name: string }>("PRAGMA table_info(silver_extracted_transactions);");
    if (silverInfo2.length > 0 && !silverInfo2.some(col => col.name === 'deleted_at')) {
      await this.run("ALTER TABLE silver_extracted_transactions ADD COLUMN deleted_at TEXT;");
    }

    const goldInfo = await this.all<{ name: string }>("PRAGMA table_info(gold_transactions);");
    if (goldInfo.length > 0 && !goldInfo.some(col => col.name === 'deleted_at')) {
      await this.run("ALTER TABLE gold_transactions ADD COLUMN deleted_at TEXT;");
    }

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
    const { EmailClassifier } = require('../services/email-classifier');
    const hasTx = email.hasTransaction !== undefined
      ? (email.hasTransaction ? 1 : 0)
      : (EmailClassifier.isTransaction(email.subject) ? 1 : 0);

    // Normalize date to ISO-8601 string for SQLite compatibility
    let normalizedReceivedAt = email.receivedAt;
    try {
      const parsedDate = new Date(email.receivedAt);
      if (!isNaN(parsedDate.getTime())) {
        normalizedReceivedAt = parsedDate.toISOString();
      }
    } catch (err) {
      // Fallback to original receivedAt string
    }

    await this.run(
      `INSERT OR IGNORE INTO bronze_raw_emails 
       (id, user_id, sender, subject, snippet, raw_body, raw_payload, received_at, has_transaction) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        email.id,
        email.userId,
        email.sender,
        email.subject,
        email.snippet,
        email.rawBody,
        email.rawPayload,
        normalizedReceivedAt,
        hasTx,
      ]
    );
  }

  async savePendingTransaction(tx: PendingTransaction): Promise<void> {
    const amountCents = Math.round(tx.amount * 100);
    
    // Determine status: 'error' if any required fields are missing
    const hasMerchant = !!(tx.merchantNormalized?.trim() || tx.merchantRaw?.trim());
    const hasDate = !!(tx.transactionDate?.trim() && tx.transactionDate !== 'N/A');
    const hasAmount = tx.amount !== undefined && tx.amount !== null && !isNaN(tx.amount) && tx.amount !== 0;
    const hasMethod = !!(tx.paymentMethod?.trim() && tx.paymentMethod !== 'Unknown' && tx.paymentMethod !== 'N/A');
    
    const calculatedStatus = (!hasMerchant || !hasDate || !hasAmount || !hasMethod) ? 'error' : tx.status;

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
        calculatedStatus,
        tx.paymentMethod || null,
      ]
    );
  }

  async getPendingTransactions(userId: string): Promise<PendingTransaction[]> {
    const rows = await this.all<any>(
      `SELECT * FROM silver_extracted_transactions WHERE status IN ('pending', 'error') AND user_id = ? AND deleted_at IS NULL`,
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
      status: row.status as PendingTransaction['status'],
      extractedAt: row.extracted_at,
      paymentMethod: row.payment_method || undefined,
    }));
  }

  async promoteToTransaction(pendingId: string, tx: Transaction): Promise<void> {
    const current = await this.getSilverTransactionById(pendingId, tx.userId);
    if (!current) {
      throw new Error('Silver transaction not found or unauthorized');
    }
    if (current.status === 'error') {
      throw new Error('Cannot promote transaction in error status');
    }
    if (!tx.merchant || !tx.transactionDate || !tx.amount || !tx.paymentMethod) {
      throw new Error('Required transaction fields (merchant, date, amount, method) are missing');
    }

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
    let sql = 'SELECT * FROM bronze_raw_emails WHERE user_id = ? AND deleted_at IS NULL';
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
      hasTransaction: row.has_transaction === 1,
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
      hasTransaction: row.has_transaction === 1,
      ingestedAt: row.ingested_at,
    };
  }

  async updateRawEmailClassification(id: string, userId: string, hasTransaction: boolean): Promise<void> {
    await this.run(
      'UPDATE bronze_raw_emails SET has_transaction = ? WHERE id = ? AND user_id = ?',
      [hasTransaction ? 1 : 0, id, userId]
    );
  }

  async getSilverTransactions(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<PendingTransaction[]> {
    let sql = `
      SELECT s.*, b.subject AS email_subject, b.sender AS email_sender, b.received_at AS email_received_at
      FROM silver_extracted_transactions s
      LEFT JOIN bronze_raw_emails b ON s.bronze_email_id = b.id AND s.user_id = b.user_id
      WHERE s.user_id = ? AND s.deleted_at IS NULL
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
      status: row.status as PendingTransaction['status'],
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
       WHERE s.bronze_email_id = ? AND s.user_id = ? AND s.deleted_at IS NULL`,
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
      status: row.status as PendingTransaction['status'],
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
       WHERE s.id = ? AND s.user_id = ? AND s.deleted_at IS NULL`,
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
      status: row.status as PendingTransaction['status'],
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
      WHERE g.user_id = ? AND g.deleted_at IS NULL
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
    const current = await this.getSilverTransactionById(id, userId);
    if (!current) {
      throw new Error('Silver transaction not found or unauthorized');
    }

    const merged = {
      ...current,
      ...updates,
    };

    const hasMerchant = !!(merged.merchantNormalized?.trim() || merged.merchantRaw?.trim());
    const hasDate = !!(merged.transactionDate?.trim() && merged.transactionDate !== 'N/A');
    const hasAmount = merged.amount !== undefined && merged.amount !== null && !isNaN(merged.amount) && merged.amount !== 0;
    const hasMethod = !!(merged.paymentMethod?.trim() && merged.paymentMethod !== 'Unknown' && merged.paymentMethod !== 'N/A');
    
    let newStatus = current.status;
    if (current.status === 'pending' || current.status === 'error') {
      newStatus = (!hasMerchant || !hasDate || !hasAmount || !hasMethod) ? 'error' : 'pending';
    }

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
    if (updates.paymentMethod !== undefined) {
      sets.push('payment_method = ?');
      params.push(updates.paymentMethod);
    }
    
    sets.push('status = ?');
    params.push(newStatus);

    params.push(id);
    params.push(userId);
    await this.run(`UPDATE silver_extracted_transactions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params);
  }

  async revertGoldToSilver(userId: string, goldId: string): Promise<void> {
    await this.run('BEGIN TRANSACTION');
    try {
      const goldTx = await this.get<any>(
        'SELECT silver_tx_id FROM gold_transactions WHERE id = ? AND user_id = ?',
        [goldId, userId]
      );
      if (!goldTx) {
        throw new Error('Gold transaction not found');
      }
      const silverTxId = goldTx.silver_tx_id;
      if (silverTxId) {
        const silverTx = await this.getSilverTransactionById(silverTxId, userId);
        if (silverTx) {
          const hasMerchant = !!(silverTx.merchantNormalized?.trim() || silverTx.merchantRaw?.trim());
          const hasDate = !!(silverTx.transactionDate?.trim() && silverTx.transactionDate !== 'N/A');
          const hasAmount = silverTx.amount !== undefined && silverTx.amount !== null && !isNaN(silverTx.amount) && silverTx.amount !== 0;
          const hasMethod = !!(silverTx.paymentMethod?.trim() && silverTx.paymentMethod !== 'Unknown' && silverTx.paymentMethod !== 'N/A');
          const calculatedStatus = (!hasMerchant || !hasDate || !hasAmount || !hasMethod) ? 'error' : 'pending';
          
          await this.run(
            `UPDATE silver_extracted_transactions 
             SET status = ?, deleted_at = NULL 
             WHERE id = ? AND user_id = ?`,
            [calculatedStatus, silverTxId, userId]
          );
        }
      }
      await this.run(
        'DELETE FROM gold_transactions WHERE id = ? AND user_id = ?',
        [goldId, userId]
      );
      await this.run('COMMIT');
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
  }

  async revertSilverToBronze(userId: string, silverId: string): Promise<void> {
    await this.run('BEGIN TRANSACTION');
    try {
      await this.run(
        'DELETE FROM gold_transactions WHERE silver_tx_id = ? AND user_id = ?',
        [silverId, userId]
      );
      await this.run(
        'DELETE FROM silver_extracted_transactions WHERE id = ? AND user_id = ?',
        [silverId, userId]
      );
      await this.run('COMMIT');
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
  }

  async deleteBronzeEmail(userId: string, bronzeId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.run(
      'UPDATE bronze_raw_emails SET deleted_at = ? WHERE id = ? AND user_id = ?',
      [now, bronzeId, userId]
    );
  }

  async restoreBronzeEmail(userId: string, bronzeId: string): Promise<void> {
    await this.run(
      'UPDATE bronze_raw_emails SET deleted_at = NULL WHERE id = ? AND user_id = ?',
      [bronzeId, userId]
    );
  }

  async getDeletedRawEmails(userId: string): Promise<RawEmail[]> {
    const rows = await this.all<any>(
      'SELECT * FROM bronze_raw_emails WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC',
      [userId]
    );
    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      sender: row.sender,
      subject: row.subject,
      snippet: row.snippet || '',
      rawBody: row.raw_body,
      rawPayload: row.raw_payload || '',
      receivedAt: row.received_at,
      hasTransaction: row.has_transaction === 1,
      ingestedAt: row.ingested_at,
      deletedAt: row.deleted_at,
    }));
  }

  async getDeletedSilverTransactions(userId: string): Promise<PendingTransaction[]> {
    const rows = await this.all<any>(
      `SELECT s.*, b.subject AS email_subject, b.sender AS email_sender, b.received_at AS email_received_at
       FROM silver_extracted_transactions s
       LEFT JOIN bronze_raw_emails b ON s.bronze_email_id = b.id AND s.user_id = b.user_id
       WHERE s.user_id = ? AND s.deleted_at IS NOT NULL ORDER BY s.deleted_at DESC`,
      [userId]
    );
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
      status: row.status as PendingTransaction['status'],
      extractedAt: row.extracted_at,
      emailSubject: row.email_subject || undefined,
      emailSender: row.email_sender || undefined,
      emailReceivedAt: row.email_received_at || undefined,
      paymentMethod: row.payment_method || undefined,
      deletedAt: row.deleted_at,
    }));
  }

  async getDeletedGoldTransactions(userId: string): Promise<Transaction[]> {
    const rows = await this.all<any>(
      `SELECT g.*, s.bronze_email_id, b.subject AS email_subject, b.sender AS email_sender, b.received_at AS email_received_at
       FROM gold_transactions g
       LEFT JOIN silver_extracted_transactions s ON g.silver_tx_id = s.id AND g.user_id = s.user_id
       LEFT JOIN bronze_raw_emails b ON s.bronze_email_id = b.id AND g.user_id = b.user_id
       WHERE g.user_id = ? AND g.deleted_at IS NOT NULL ORDER BY g.deleted_at DESC`,
      [userId]
    );
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
      deletedAt: row.deleted_at,
    }));
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
