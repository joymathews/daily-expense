import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ITransactionRepository, RawInput, PendingTransaction, Transaction } from './transaction-repository';

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

    // Dynamic Migration check: check if old 'bronze_raw_emails' exists or if generic columns are missing
    const tables = await this.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table';");
    const hasBronzeEmails = tables.some(t => t.name === 'bronze_raw_emails');
    const hasBronzeInputs = tables.some(t => t.name === 'bronze_raw_inputs');

    let isLegacy = false;
    if (hasBronzeEmails) {
      isLegacy = true;
    } else if (hasBronzeInputs) {
      const bronzeInfo = await this.all<{ name: string }>("PRAGMA table_info(bronze_raw_inputs);");
      const hasStatusCol = bronzeInfo.some(col => col.name === 'status');
      if (!hasStatusCol) {
        isLegacy = true;
      } else {
        const silverInfo = await this.all<{ name: string }>("PRAGMA table_info(silver_extracted_transactions);");
        const hasBronzeInputId = silverInfo.some(col => col.name === 'bronze_input_id');
        const hasSourceType = silverInfo.some(col => col.name === 'source_type');
        const hasTxType = silverInfo.some(col => col.name === 'transaction_type');
        if (!hasBronzeInputId || !hasSourceType || !hasTxType) {
          isLegacy = true;
        }
      }
    }

    if (isLegacy) {
      await this.run('DROP TABLE IF EXISTS gold_transactions;');
      await this.run('DROP TABLE IF EXISTS silver_extracted_transactions;');
      await this.run('DROP TABLE IF EXISTS bronze_raw_emails;');
      await this.run('DROP TABLE IF EXISTS bronze_raw_inputs;');
    }

    // 1. Bronze table: Raw Ingestion (Generic)
    await this.run(`
      CREATE TABLE IF NOT EXISTS bronze_raw_inputs (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        sender TEXT NOT NULL,
        title TEXT NOT NULL,
        snippet TEXT,
        raw_body TEXT NOT NULL,
        raw_payload TEXT,
        received_at TEXT NOT NULL,
        has_transaction INTEGER NOT NULL DEFAULT 1,
        status TEXT DEFAULT 'unprocessed' CHECK (status IN ('unprocessed', 'processed', 'rejected')),
        ingested_at TEXT DEFAULT (datetime('now', 'utc')),
        deleted_at TEXT,
        PRIMARY KEY (user_id, id)
      );
    `);

    // 2. Silver table: Staging Area (Generic)
    await this.run(`
      CREATE TABLE IF NOT EXISTS silver_extracted_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        bronze_input_id TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'email',
        merchant_raw TEXT NOT NULL,
        merchant_normalized TEXT,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        transaction_date TEXT NOT NULL,
        inferred_category TEXT,
        confidence_score REAL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'error')),
        payment_method TEXT,
        transaction_type TEXT DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund')),
        parent_transaction_id TEXT,
        deleted_at TEXT,
        extracted_at TEXT DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (user_id, bronze_input_id) REFERENCES bronze_raw_inputs(user_id, id) ON DELETE CASCADE,
        UNIQUE(user_id, bronze_input_id),
        UNIQUE(user_id, id)
      );
    `);

    // 3. Gold table: Confirmed Ledger (Generic with source tracking)
    await this.run(`
      CREATE TABLE IF NOT EXISTS gold_transactions (
        id TEXT PRIMARY KEY,
        silver_tx_id TEXT UNIQUE,
        user_id TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'email',
        merchant TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        transaction_date TEXT NOT NULL,
        category TEXT NOT NULL,
        notes TEXT,
        payment_method TEXT,
        transaction_type TEXT DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund')),
        parent_transaction_id TEXT,
        deleted_at TEXT,
        created_at TEXT DEFAULT (datetime('now', 'utc')),
        updated_at TEXT DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (user_id, silver_tx_id) REFERENCES silver_extracted_transactions(user_id, id) ON DELETE SET NULL,
        FOREIGN KEY (user_id, parent_transaction_id) REFERENCES gold_transactions(user_id, id) ON DELETE SET NULL,
        UNIQUE(user_id, id)
      );
    `);

    // 3.1 LLM Ingestion Logs: Immutable log of parser output
    await this.run(`
      CREATE TABLE IF NOT EXISTS llm_extraction_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        bronze_input_id TEXT NOT NULL UNIQUE,
        extracted_merchant TEXT,
        extracted_amount_cents INTEGER,
        extracted_currency TEXT,
        extracted_date TEXT,
        extracted_category TEXT,
        extracted_payment_method TEXT,
        extracted_transaction_type TEXT DEFAULT 'expense' CHECK (extracted_transaction_type IN ('expense', 'refund')),
        confidence_score REAL,
        extracted_at TEXT DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (user_id, bronze_input_id) REFERENCES bronze_raw_inputs(user_id, id) ON DELETE CASCADE,
        UNIQUE(user_id, bronze_input_id),
        UNIQUE(user_id, id)
      );
    `);

    // 4. Create Indexes
    await this.run('CREATE INDEX IF NOT EXISTS idx_bronze_inputs_sender ON bronze_raw_inputs(sender);');
    await this.run('CREATE INDEX IF NOT EXISTS idx_silver_tx_status ON silver_extracted_transactions(status);');
    await this.run('CREATE INDEX IF NOT EXISTS idx_gold_tx_user_date ON gold_transactions(user_id, transaction_date);');
    await this.run('CREATE INDEX IF NOT EXISTS idx_llm_logs_bronze ON llm_extraction_logs(user_id, bronze_input_id);');

    // 5. Payment Standardization tables
    await this.run(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'utc')),
        UNIQUE(user_id, name)
      );
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS payment_mapping_rules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        alias_pattern TEXT NOT NULL,
        payment_method_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE CASCADE,
        UNIQUE(user_id, alias_pattern)
      );
    `);

    await this.run('CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON payment_methods(user_id);');
    await this.run('CREATE INDEX IF NOT EXISTS idx_payment_rules_user ON payment_mapping_rules(user_id);');
  }

  async emailExists(gmailId: string, userId: string): Promise<boolean> {
    const row = await this.get<{ id: string }>('SELECT id FROM bronze_raw_inputs WHERE id = ? AND user_id = ?', [gmailId, userId]);
    return !!row;
  }

  async saveRawInput(input: RawInput): Promise<void> {
    // Normalize date to ISO-8601 string for SQLite compatibility
    let normalizedReceivedAt = input.receivedAt;
    try {
      const parsedDate = new Date(input.receivedAt);
      if (!isNaN(parsedDate.getTime())) {
        normalizedReceivedAt = parsedDate.toISOString();
      }
    } catch (err) {
      // Fallback to original receivedAt string
    }

    let hasTx = 1;
    if (input.hasTransaction !== undefined) {
      hasTx = input.hasTransaction ? 1 : 0;
    } else if (!input.sourceType || input.sourceType === 'email') {
      try {
        const { EmailClassifier } = require('../services/email-classifier');
        hasTx = EmailClassifier.isTransaction(input.title) ? 1 : 0;
      } catch (e) {
        hasTx = 1;
      }
    }

    await this.run(
      `INSERT OR IGNORE INTO bronze_raw_inputs 
       (id, user_id, source_type, sender, title, snippet, raw_body, raw_payload, received_at, has_transaction) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.userId,
        input.sourceType || 'email',
        input.sender,
        input.title,
        input.snippet,
        input.rawBody,
        input.rawPayload,
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

    await this.run('BEGIN TRANSACTION');
    try {
      await this.run(
        `INSERT OR IGNORE INTO silver_extracted_transactions 
         (id, user_id, bronze_input_id, source_type, merchant_raw, merchant_normalized, amount_cents, currency, transaction_date, inferred_category, confidence_score, status, payment_method, transaction_type, parent_transaction_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tx.id,
          tx.userId,
          tx.bronzeInputId,
          tx.sourceType || 'email',
          tx.merchantRaw,
          tx.merchantNormalized || null,
          amountCents,
          tx.currency,
          tx.transactionDate,
          tx.inferredCategory || null,
          tx.confidenceScore ?? null,
          calculatedStatus,
          tx.paymentMethod || null,
          tx.transactionType || 'expense',
          tx.parentTransactionId || null,
        ]
      );
      await this.run(
        `INSERT OR IGNORE INTO llm_extraction_logs 
         (id, user_id, bronze_input_id, extracted_merchant, extracted_amount_cents, extracted_currency, extracted_date, extracted_category, extracted_payment_method, extracted_transaction_type, confidence_score) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          tx.userId,
          tx.bronzeInputId,
          tx.merchantRaw,
          amountCents,
          tx.currency,
          tx.transactionDate,
          tx.inferredCategory || null,
          tx.paymentMethod || null,
          tx.transactionType || 'expense',
          tx.confidenceScore ?? null
        ]
      );
      await this.run(
        "UPDATE bronze_raw_inputs SET status = 'processed' WHERE id = ? AND user_id = ?",
        [tx.bronzeInputId, tx.userId]
      );
      await this.run('COMMIT');
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
  }

  async getPendingTransactions(userId: string): Promise<PendingTransaction[]> {
    const rows = await this.all<any>(
      `SELECT s.*, b.title AS source_title, b.sender AS source_sender, b.received_at AS source_received_at 
       FROM silver_extracted_transactions s
       LEFT JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
       WHERE s.status IN ('pending', 'error') AND s.user_id = ? AND s.deleted_at IS NULL`,
      [userId]
    );

    return rows.map(row => ({
      id: row.id,
      bronzeInputId: row.bronze_input_id,
      userId: row.user_id,
      sourceType: row.source_type,
      merchantRaw: row.merchant_raw,
      merchantNormalized: row.merchant_normalized || undefined,
      amount: row.amount_cents / 100,
      currency: row.currency,
      transactionDate: row.transaction_date,
      inferredCategory: row.inferred_category || undefined,
      confidenceScore: row.confidence_score ?? undefined,
      status: row.status as PendingTransaction['status'],
      extractedAt: row.extracted_at,
      sourceTitle: row.source_title || undefined,
      sourceSender: row.source_sender || undefined,
      sourceReceivedAt: row.source_received_at || undefined,
      paymentMethod: row.payment_method || undefined,
      transactionType: row.transaction_type || 'expense',
      parentTransactionId: row.parent_transaction_id || undefined,
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
      // 1. Update status in silver staging table
      await this.run(
        `UPDATE silver_extracted_transactions SET status = 'approved' WHERE id = ? AND user_id = ?`,
        [pendingId, tx.userId]
      );

      // 2. Insert validated transaction in gold ledger table
      await this.run(
        `INSERT OR IGNORE INTO gold_transactions 
         (id, silver_tx_id, user_id, source_type, merchant, amount_cents, currency, transaction_date, category, notes, payment_method, transaction_type, parent_transaction_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tx.id,
          pendingId,
          tx.userId,
          tx.sourceType || 'email',
          tx.merchant,
          amountCents,
          tx.currency,
          tx.transactionDate,
          tx.category,
          tx.notes || null,
          tx.paymentMethod || null,
          tx.transactionType || 'expense',
          tx.parentTransactionId || null,
        ]
      );

      await this.run('COMMIT');
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
  }

  async addDirectGoldTransaction(tx: Transaction): Promise<void> {
    if (!tx.merchant || !tx.transactionDate || !tx.amount || !tx.paymentMethod) {
      throw new Error('Required transaction fields (merchant, date, amount, method) are missing');
    }
    if (tx.amount <= 0) {
      throw new Error('Amount must be positive');
    }

    const amountCents = Math.round(tx.amount * 100);

    await this.run(
      `INSERT OR IGNORE INTO gold_transactions 
       (id, silver_tx_id, user_id, source_type, merchant, amount_cents, currency, transaction_date, category, notes, payment_method, transaction_type, parent_transaction_id) 
       VALUES (?, NULL, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tx.id,
        tx.userId,
        tx.merchant,
        amountCents,
        tx.currency || 'INR',
        tx.transactionDate,
        tx.category,
        tx.notes || null,
        tx.paymentMethod,
        tx.transactionType || 'expense',
        tx.parentTransactionId || null,
      ]
    );
  }

  async getRawInputs(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<RawInput[]> {
    let sql = 'SELECT * FROM bronze_raw_inputs WHERE user_id = ? AND deleted_at IS NULL';
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
      sourceType: row.source_type,
      sender: row.sender,
      title: row.title,
      snippet: row.snippet || '',
      rawBody: row.raw_body,
      rawPayload: row.raw_payload || '',
      receivedAt: row.received_at,
      hasTransaction: row.has_transaction === 1,
      status: row.status,
      ingestedAt: row.ingested_at,
    }));
  }

  async getRawInputById(id: string, userId: string): Promise<RawInput | undefined> {
    const row = await this.get<any>('SELECT * FROM bronze_raw_inputs WHERE id = ? AND user_id = ?', [id, userId]);
    if (!row) return undefined;
    return {
      id: row.id,
      userId: row.user_id,
      sourceType: row.source_type,
      sender: row.sender,
      title: row.title,
      snippet: row.snippet || '',
      rawBody: row.raw_body,
      rawPayload: row.raw_payload || '',
      receivedAt: row.received_at,
      hasTransaction: row.has_transaction === 1,
      status: row.status,
      ingestedAt: row.ingested_at,
    };
  }

  async updateRawInputClassification(id: string, userId: string, hasTransaction: boolean): Promise<void> {
    await this.run(
      'UPDATE bronze_raw_inputs SET has_transaction = ? WHERE id = ? AND user_id = ?',
      [hasTransaction ? 1 : 0, id, userId]
    );
  }

  async updateRawInputStatus(id: string, userId: string, status: 'unprocessed' | 'processed' | 'rejected'): Promise<void> {
    await this.run(
      'UPDATE bronze_raw_inputs SET status = ? WHERE id = ? AND user_id = ?',
      [status, id, userId]
    );
  }

  async getSilverTransactions(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<PendingTransaction[]> {
    let sql = `
      SELECT s.*, b.title AS source_title, b.sender AS source_sender, b.received_at AS source_received_at
      FROM silver_extracted_transactions s
      LEFT JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
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
      bronzeInputId: row.bronze_input_id,
      userId: row.user_id,
      sourceType: row.source_type,
      merchantRaw: row.merchant_raw,
      merchantNormalized: row.merchant_normalized || undefined,
      amount: row.amount_cents / 100,
      currency: row.currency,
      transactionDate: row.transaction_date,
      inferredCategory: row.inferred_category || undefined,
      confidenceScore: row.confidence_score ?? undefined,
      status: row.status as PendingTransaction['status'],
      extractedAt: row.extracted_at,
      sourceTitle: row.source_title || undefined,
      sourceSender: row.source_sender || undefined,
      sourceReceivedAt: row.source_received_at || undefined,
      paymentMethod: row.payment_method || undefined,
      transactionType: row.transaction_type || 'expense',
      parentTransactionId: row.parent_transaction_id || undefined,
    }));
  }

  async getSilverTransactionByInputId(inputId: string, userId: string): Promise<PendingTransaction | undefined> {
    const row = await this.get<any>(
      `SELECT s.*, b.title AS source_title, b.sender AS source_sender, b.received_at AS source_received_at
       FROM silver_extracted_transactions s
       LEFT JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
       WHERE s.bronze_input_id = ? AND s.user_id = ? AND s.deleted_at IS NULL`,
      [inputId, userId]
    );
    if (!row) return undefined;
    return {
      id: row.id,
      bronzeInputId: row.bronze_input_id,
      userId: row.user_id,
      sourceType: row.source_type,
      merchantRaw: row.merchant_raw,
      merchantNormalized: row.merchant_normalized || undefined,
      amount: row.amount_cents / 100,
      currency: row.currency,
      transactionDate: row.transaction_date,
      inferredCategory: row.inferred_category || undefined,
      confidenceScore: row.confidence_score ?? undefined,
      status: row.status as PendingTransaction['status'],
      extractedAt: row.extracted_at,
      sourceTitle: row.source_title || undefined,
      sourceSender: row.source_sender || undefined,
      sourceReceivedAt: row.source_received_at || undefined,
      paymentMethod: row.payment_method || undefined,
      transactionType: row.transaction_type || 'expense',
      parentTransactionId: row.parent_transaction_id || undefined,
    };
  }

  async getSilverTransactionById(id: string, userId: string): Promise<PendingTransaction | undefined> {
    const row = await this.get<any>(
      `SELECT s.*, b.title AS source_title, b.sender AS source_sender, b.received_at AS source_received_at
       FROM silver_extracted_transactions s
       LEFT JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
       WHERE s.id = ? AND s.user_id = ? AND s.deleted_at IS NULL`,
      [id, userId]
    );
    if (!row) return undefined;
    return {
      id: row.id,
      bronzeInputId: row.bronze_input_id,
      userId: row.user_id,
      sourceType: row.source_type,
      merchantRaw: row.merchant_raw,
      merchantNormalized: row.merchant_normalized || undefined,
      amount: row.amount_cents / 100,
      currency: row.currency,
      transactionDate: row.transaction_date,
      inferredCategory: row.inferred_category || undefined,
      confidenceScore: row.confidence_score ?? undefined,
      status: row.status as PendingTransaction['status'],
      extractedAt: row.extracted_at,
      sourceTitle: row.source_title || undefined,
      sourceSender: row.source_sender || undefined,
      sourceReceivedAt: row.source_received_at || undefined,
      paymentMethod: row.payment_method || undefined,
      transactionType: row.transaction_type || 'expense',
      parentTransactionId: row.parent_transaction_id || undefined,
    };
  }

  async getGoldTransactions(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<Transaction[]> {
    let sql = `
      SELECT g.*, s.bronze_input_id, b.title AS source_title, b.sender AS source_sender, b.received_at AS source_received_at
      FROM gold_transactions g
      LEFT JOIN silver_extracted_transactions s ON g.silver_tx_id = s.id AND g.user_id = s.user_id
      LEFT JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND g.user_id = b.user_id
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
      sourceType: row.source_type,
      merchant: row.merchant,
      amount: row.amount_cents / 100,
      currency: row.currency,
      transactionDate: row.transaction_date,
      category: row.category,
      notes: row.notes || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sourceTitle: row.source_title || undefined,
      sourceSender: row.source_sender || undefined,
      sourceReceivedAt: row.source_received_at || undefined,
      bronzeInputId: row.bronze_input_id || undefined,
      paymentMethod: row.payment_method || undefined,
      transactionType: row.transaction_type || 'expense',
      parentTransactionId: row.parent_transaction_id || undefined,
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
      params.push(updates.notes || null);
    }
    if (updates.paymentMethod !== undefined) {
      sets.push('payment_method = ?');
      params.push(updates.paymentMethod || null);
    }
    if (updates.transactionType !== undefined) {
      sets.push('transaction_type = ?');
      params.push(updates.transactionType);
    }
    if (updates.parentTransactionId !== undefined) {
      sets.push('parent_transaction_id = ?');
      params.push(updates.parentTransactionId || null);
    }

    if (sets.length === 0) return;

    sets.push("updated_at = datetime('now', 'utc')");
    params.push(id, userId);

    await this.run(
      `UPDATE gold_transactions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );
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
      params.push(updates.merchantNormalized || null);
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
      params.push(updates.inferredCategory || null);
    }
    if (updates.paymentMethod !== undefined) {
      sets.push('payment_method = ?');
      params.push(updates.paymentMethod || null);
    }
    if (updates.status !== undefined) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.transactionType !== undefined) {
      sets.push('transaction_type = ?');
      params.push(updates.transactionType);
    }
    if (updates.parentTransactionId !== undefined) {
      sets.push('parent_transaction_id = ?');
      params.push(updates.parentTransactionId || null);
    }

    if (sets.length === 0) return;

    if (updates.status === undefined) {
      // Check status check requirements
      let checkMerchant = updates.merchantNormalized || updates.merchantRaw;
      let checkDate = updates.transactionDate;
      let checkAmount = updates.amount;
      let checkMethod = updates.paymentMethod;

      if (updates.merchantNormalized === undefined && updates.merchantRaw === undefined) {
        const current = await this.getSilverTransactionById(id, userId);
        if (current) {
          checkMerchant = current.merchantNormalized || current.merchantRaw;
        }
      }
      if (updates.transactionDate === undefined) {
        const current = await this.getSilverTransactionById(id, userId);
        if (current) checkDate = current.transactionDate;
      }
      if (updates.amount === undefined) {
        const current = await this.getSilverTransactionById(id, userId);
        if (current) checkAmount = current.amount;
      }
      if (updates.paymentMethod === undefined) {
        const current = await this.getSilverTransactionById(id, userId);
        if (current) checkMethod = current.paymentMethod;
      }

      const hasMerchant = !!(checkMerchant?.trim());
      const hasDate = !!(checkDate?.trim() && checkDate !== 'N/A');
      const hasAmount = checkAmount !== undefined && checkAmount !== null && !isNaN(checkAmount) && checkAmount !== 0;
      const hasMethod = !!(checkMethod?.trim() && checkMethod !== 'Unknown' && checkMethod !== 'N/A');

      const nextStatus = (!hasMerchant || !hasDate || !hasAmount || !hasMethod) ? 'error' : 'pending';
      sets.push('status = ?');
      params.push(nextStatus);
    }


    params.push(id, userId);

    await this.run(
      `UPDATE silver_extracted_transactions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );
  }

  async revertGoldToSilver(userId: string, goldId: string): Promise<void> {
    await this.run('BEGIN TRANSACTION');
    try {
      const goldTx = await this.get<{ silver_tx_id: string; source_type: string }>(
        'SELECT silver_tx_id, source_type FROM gold_transactions WHERE id = ? AND user_id = ?',
        [goldId, userId]
      );
      if (!goldTx) {
        throw new Error('Gold transaction not found');
      }
      const silverTxId = goldTx.silver_tx_id;
      if (goldTx.source_type === 'manual' || !silverTxId) {
        const now = new Date().toISOString();
        await this.run(
          'UPDATE gold_transactions SET deleted_at = ? WHERE id = ? AND user_id = ?',
          [now, goldId, userId]
        );
      } else {
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
      }
      await this.run('COMMIT');
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
  }

  async revertSilverToBronze(userId: string, silverId: string): Promise<void> {
    await this.run('BEGIN TRANSACTION');
    try {
      const silver = await this.getSilverTransactionById(silverId, userId);
      await this.run(
        'DELETE FROM gold_transactions WHERE silver_tx_id = ? AND user_id = ?',
        [silverId, userId]
      );
      await this.run(
        'DELETE FROM silver_extracted_transactions WHERE id = ? AND user_id = ?',
        [silverId, userId]
      );
      if (silver) {
        await this.run(
          "UPDATE bronze_raw_inputs SET status = 'unprocessed' WHERE id = ? AND user_id = ?",
          [silver.bronzeInputId, userId]
        );
      }
      await this.run('COMMIT');
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
  }

  async deleteBronzeInput(userId: string, bronzeId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.run(
      'UPDATE bronze_raw_inputs SET deleted_at = ? WHERE id = ? AND user_id = ?',
      [now, bronzeId, userId]
    );
  }

  async restoreBronzeInput(userId: string, bronzeId: string): Promise<void> {
    await this.run(
      'UPDATE bronze_raw_inputs SET deleted_at = NULL WHERE id = ? AND user_id = ?',
      [bronzeId, userId]
    );
  }

  async restoreGoldTransaction(userId: string, goldId: string): Promise<void> {
    await this.run(
      'UPDATE gold_transactions SET deleted_at = NULL WHERE id = ? AND user_id = ?',
      [goldId, userId]
    );
  }

  async getDeletedRawInputs(userId: string): Promise<RawInput[]> {
    const rows = await this.all<any>(
      'SELECT * FROM bronze_raw_inputs WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC',
      [userId]
    );
    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      sourceType: row.source_type,
      sender: row.sender,
      title: row.title,
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
      `SELECT s.*, b.title AS source_title, b.sender AS source_sender, b.received_at AS source_received_at
       FROM silver_extracted_transactions s
       LEFT JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
       WHERE s.user_id = ? AND s.deleted_at IS NOT NULL ORDER BY s.deleted_at DESC`,
      [userId]
    );
    return rows.map(row => ({
      id: row.id,
      bronzeInputId: row.bronze_input_id,
      userId: row.user_id,
      sourceType: row.source_type,
      merchantRaw: row.merchant_raw,
      merchantNormalized: row.merchant_normalized || undefined,
      amount: row.amount_cents / 100,
      currency: row.currency,
      transactionDate: row.transaction_date,
      inferredCategory: row.inferred_category || undefined,
      confidenceScore: row.confidence_score ?? undefined,
      status: row.status as PendingTransaction['status'],
      extractedAt: row.extracted_at,
      sourceTitle: row.source_title || undefined,
      sourceSender: row.source_sender || undefined,
      sourceReceivedAt: row.source_received_at || undefined,
      paymentMethod: row.payment_method || undefined,
      deletedAt: row.deleted_at,
    }));
  }

  async getDeletedGoldTransactions(userId: string): Promise<Transaction[]> {
    const rows = await this.all<any>(
      `SELECT g.*, s.bronze_input_id, b.title AS source_title, b.sender AS source_sender, b.received_at AS source_received_at
       FROM gold_transactions g
       LEFT JOIN silver_extracted_transactions s ON g.silver_tx_id = s.id AND g.user_id = s.user_id
       LEFT JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND g.user_id = b.user_id
       WHERE g.user_id = ? AND g.deleted_at IS NOT NULL ORDER BY g.deleted_at DESC`,
      [userId]
    );
    return rows.map(row => ({
      id: row.id,
      pendingTxId: row.silver_tx_id || undefined,
      userId: row.user_id,
      sourceType: row.source_type,
      merchant: row.merchant,
      amount: row.amount_cents / 100,
      currency: row.currency,
      transactionDate: row.transaction_date,
      category: row.category,
      notes: row.notes || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sourceTitle: row.source_title || undefined,
      sourceSender: row.source_sender || undefined,
      sourceReceivedAt: row.source_received_at || undefined,
      bronzeInputId: row.bronze_input_id || undefined,
      paymentMethod: row.payment_method || undefined,
      deletedAt: row.deleted_at,
    }));
  }

  async getPaymentMethods(userId: string): Promise<any[]> {
    const rows = await this.all<any>(
      'SELECT * FROM payment_methods WHERE user_id = ? ORDER BY name ASC',
      [userId]
    );
    if (rows.length === 0) {
      await this.seedDefaultPaymentMethodsAndRules(userId);
      const newRows = await this.all<any>(
        'SELECT * FROM payment_methods WHERE user_id = ? ORDER BY name ASC',
        [userId]
      );
      return newRows.map(r => ({
        id: r.id,
        userId: r.user_id,
        name: r.name,
      }));
    }
    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
    }));
  }

  async savePaymentMethod(method: any): Promise<void> {
    await this.run(
      'INSERT INTO payment_methods (id, user_id, name) VALUES (?, ?, ?)',
      [method.id, method.userId, method.name]
    );
  }

  async updatePaymentMethod(id: string, userId: string, name: string): Promise<void> {
    await this.run(
      'UPDATE payment_methods SET name = ? WHERE id = ? AND user_id = ?',
      [name, id, userId]
    );
  }

  async deletePaymentMethod(id: string, userId: string): Promise<void> {
    await this.run(
      'DELETE FROM payment_methods WHERE id = ? AND user_id = ?',
      [id, userId]
    );
  }

  async getPaymentMappingRules(userId: string): Promise<any[]> {
    // Ensure default methods and rules are seeded first by calling getPaymentMethods
    await this.getPaymentMethods(userId);

    const rows = await this.all<any>(
      `SELECT r.*, m.name AS payment_method_name 
       FROM payment_mapping_rules r
       JOIN payment_methods m ON r.payment_method_id = m.id
       WHERE r.user_id = ?
       ORDER BY r.created_at ASC`,
      [userId]
    );
    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      aliasPattern: r.alias_pattern,
      paymentMethodId: r.payment_method_id,
      paymentMethodName: r.payment_method_name,
    }));
  }

  async savePaymentMappingRule(rule: any): Promise<void> {
    await this.run(
      'INSERT INTO payment_mapping_rules (id, user_id, alias_pattern, payment_method_id) VALUES (?, ?, ?, ?)',
      [rule.id, rule.userId, rule.aliasPattern, rule.paymentMethodId]
    );
  }

  async updatePaymentMappingRule(id: string, userId: string, aliasPattern: string, methodId: string): Promise<void> {
    await this.run(
      'UPDATE payment_mapping_rules SET alias_pattern = ?, payment_method_id = ? WHERE id = ? AND user_id = ?',
      [aliasPattern, methodId, id, userId]
    );
  }

  async deletePaymentMappingRule(id: string, userId: string): Promise<void> {
    await this.run(
      'DELETE FROM payment_mapping_rules WHERE id = ? AND user_id = ?',
      [id, userId]
    );
  }

  async standardizePaymentMethod(userId: string, rawPaymentMethod: string | undefined): Promise<string> {
    if (!rawPaymentMethod || rawPaymentMethod.trim() === '' || rawPaymentMethod === 'Unknown' || rawPaymentMethod === 'N/A') {
      return 'Unknown';
    }

    const trimmedRaw = rawPaymentMethod.trim();
    const lowerRaw = trimmedRaw.toLowerCase();

    // 1. Fetch rules (supports +, & or , for AND combinations)
    const rules = await this.getPaymentMappingRules(userId);
    for (const rule of rules) {
      if (rule.aliasPattern) {
        const parts = rule.aliasPattern.split(/[+&,]/).map((p: string) => p.trim().toLowerCase()).filter(Boolean);
        if (parts.length > 0) {
          const allMatch = parts.every((part: string) => lowerRaw.includes(part));
          if (allMatch) {
            return rule.paymentMethodName || 'Unknown';
          }
        }
      }
    }

    // 2. If no rule matches, check if it matches any standardized method name exactly (case-insensitive)
    const methods = await this.getPaymentMethods(userId);
    const exactMatch = methods.find(m => m.name.toLowerCase() === lowerRaw);
    if (exactMatch) {
      return exactMatch.name;
    }

    // 3. Fallback: check if any standardized method name is contained in the raw string
    const partialMatch = methods.find(m => lowerRaw.includes(m.name.toLowerCase()));
    if (partialMatch) {
      return partialMatch.name;
    }

    return trimmedRaw; // Fallback to raw if no match
  }

  private async seedDefaultPaymentMethodsAndRules(userId: string): Promise<void> {
    const pmUpiId = crypto.randomUUID();
    const pmCashId = crypto.randomUUID();
    const pmHdfcId = crypto.randomUUID();
    const pmSbiId = crypto.randomUUID();

    const defaultMethods = [
      { id: pmUpiId, name: 'UPI' },
      { id: pmCashId, name: 'Cash' },
      { id: pmHdfcId, name: 'HDFC Credit Card' },
      { id: pmSbiId, name: 'SBI Debit Card' },
    ];
    const defaultRules = [
      { id: crypto.randomUUID(), pattern: 'upi', methodId: pmUpiId },
      { id: crypto.randomUUID(), pattern: 'cash', methodId: pmCashId },
      { id: crypto.randomUUID(), pattern: 'hdfc', methodId: pmHdfcId },
      { id: crypto.randomUUID(), pattern: 'sbi', methodId: pmSbiId },
    ];

    await this.run('BEGIN TRANSACTION');
    try {
      for (const m of defaultMethods) {
        await this.run(
          'INSERT OR IGNORE INTO payment_methods (id, user_id, name) VALUES (?, ?, ?)',
          [m.id, userId, m.name]
        );
      }
      for (const r of defaultRules) {
        await this.run(
          'INSERT OR IGNORE INTO payment_mapping_rules (id, user_id, alias_pattern, payment_method_id) VALUES (?, ?, ?, ?)',
          [r.id, userId, r.pattern, r.methodId]
        );
      }
      await this.run('COMMIT');
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
  }

  async getLlmExtractionLogByBronzeId(bronzeId: string, userId: string): Promise<any | null> {
    const row = await this.get<any>(
      'SELECT * FROM llm_extraction_logs WHERE bronze_input_id = ? AND user_id = ?',
      [bronzeId, userId]
    );
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      bronzeInputId: row.bronze_input_id,
      extractedMerchant: row.extracted_merchant,
      extractedAmount: row.extracted_amount_cents / 100,
      extractedCurrency: row.extracted_currency,
      extractedDate: row.extracted_date,
      extractedCategory: row.extracted_category,
      extractedPaymentMethod: row.extracted_payment_method,
      extractedTransactionType: row.extracted_transaction_type,
      confidenceScore: row.confidence_score,
      extractedAt: row.extracted_at
    };
  }

  async getLlmAccuracyStats(userId: string): Promise<{
    overallAccuracy: number;
    merchantAccuracy: number;
    amountAccuracy: number;
    categoryAccuracy: number;
    paymentMethodAccuracy: number;
    totalTested: number;
  }> {
    const rows = await this.all<any>(
      `SELECT 
         g.merchant, l.extracted_merchant,
         g.amount_cents, l.extracted_amount_cents,
         g.category, l.extracted_category,
         g.payment_method, l.extracted_payment_method
       FROM gold_transactions g
       JOIN silver_extracted_transactions s ON g.silver_tx_id = s.id AND g.user_id = s.user_id
       JOIN llm_extraction_logs l ON s.bronze_input_id = l.bronze_input_id AND s.user_id = l.user_id
       WHERE g.user_id = ? AND g.deleted_at IS NULL`,
      [userId]
    );

    const total = rows.length;
    if (total === 0) {
      return {
        overallAccuracy: 100,
        merchantAccuracy: 100,
        amountAccuracy: 100,
        categoryAccuracy: 100,
        paymentMethodAccuracy: 100,
        totalTested: 0
      };
    }

    let merchantMatches = 0;
    let amountMatches = 0;
    let categoryMatches = 0;
    let paymentMethodMatches = 0;

    for (const r of rows) {
      if ((r.merchant || '').trim().toLowerCase() === (r.extracted_merchant || '').trim().toLowerCase()) {
        merchantMatches++;
      }
      if (r.amount_cents === r.extracted_amount_cents) {
        amountMatches++;
      }
      if ((r.category || '').trim().toLowerCase() === (r.extracted_category || '').trim().toLowerCase()) {
        categoryMatches++;
      }
      const normMethod = (r.payment_method || '').trim().toLowerCase();
      const normExtractedMethod = (r.extracted_payment_method || '').trim().toLowerCase();
      const isMethodEmpty = !normMethod || normMethod === 'unknown' || normMethod === 'n/a';
      const isExtractedEmpty = !normExtractedMethod || normExtractedMethod === 'unknown' || normExtractedMethod === 'n/a';
      if (normMethod === normExtractedMethod || (isMethodEmpty && isExtractedEmpty)) {
        paymentMethodMatches++;
      }
    }

    const merchantAccuracy = Math.round((merchantMatches / total) * 100);
    const amountAccuracy = Math.round((amountMatches / total) * 100);
    const categoryAccuracy = Math.round((categoryMatches / total) * 100);
    const paymentMethodAccuracy = Math.round((paymentMethodMatches / total) * 100);
    
    const overallAccuracy = Math.round(
      ((merchantMatches + amountMatches + categoryMatches + paymentMethodMatches) / (total * 4)) * 100
    );

    return {
      overallAccuracy,
      merchantAccuracy,
      amountAccuracy,
      categoryAccuracy,
      paymentMethodAccuracy,
      totalTested: total
    };
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
