import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ITransactionRepository, RawInput, PendingTransaction, Transaction, FixedCharge } from './transaction-repository';
import { IFeedbackRepository, FeedbackSettings, CorrectionExample, CorrectionFieldName, FeedbackEffectiveness } from './feedback-repository';
import { normalizeCategory } from '../utils/category-helper';
import { PaymentStandardizationService } from '../services/payment-standardization-service';
import { logger } from '../utils/logger';

export class SQLiteTransactionRepository implements ITransactionRepository, IFeedbackRepository {
  private db: sqlite3.Database;

  constructor(dbPath: string = process.env.DATABASE_URL || './data/daily_expense.db') {
    if (dbPath === ':memory:') {
      this.db = new sqlite3.Database(dbPath);
      logger.info('Initialized in-memory SQLite database connection');
      return;
    }

    // Resolve absolute path and ensure the parent directory exists
    const resolvedPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
    const parentDir = path.dirname(resolvedPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    this.db = new sqlite3.Database(resolvedPath);
    logger.info({ resolvedPath }, 'Initialized file-based SQLite database connection');
  }

  // Wrap runs/queries in Promise utilities for clean async/await code
  public run(sql: string, params: any[] = []): Promise<void> {
    logger.debug({ sql, params }, 'Database run query started');
    const start = Date.now();
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        const duration = Date.now() - start;
        if (err) {
          logger.error({ sql, params, err, duration }, 'Database run query failed');
          reject(err);
        } else {
          logger.trace({ sql, duration }, 'Database run query completed');
          resolve();
        }
      });
    });
  }

  private get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    logger.debug({ sql, params }, 'Database get query started');
    const start = Date.now();
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        const duration = Date.now() - start;
        if (err) {
          logger.error({ sql, params, err, duration }, 'Database get query failed');
          reject(err);
        } else {
          logger.trace({ sql, duration, hasRow: !!row }, 'Database get query completed');
          resolve(row as T);
        }
      });
    });
  }

  private all<T>(sql: string, params: any[] = []): Promise<T[]> {
    logger.debug({ sql, params }, 'Database all query started');
    const start = Date.now();
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        const duration = Date.now() - start;
        if (err) {
          logger.error({ sql, params, err, duration }, 'Database all query failed');
          reject(err);
        } else {
          logger.trace({ sql, duration, rowsCount: rows?.length || 0 }, 'Database all query completed');
          resolve(rows as T[]);
        }
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

    // Migration guard: upgrade transaction_type CHECK constraint to include 'transfer'
    // SQLite cannot ALTER a CHECK constraint in-place, so we recreate affected tables.
    await this.migrateTransactionTypeConstraintIfNeeded();

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
        transaction_type TEXT DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund', 'transfer', 'fixed')),
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
        transaction_type TEXT DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund', 'transfer', 'fixed')),
        parent_transaction_id TEXT,
        source_received_at TEXT,
        deleted_at TEXT,
        created_at TEXT DEFAULT (datetime('now', 'utc')),
        updated_at TEXT DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (user_id, silver_tx_id) REFERENCES silver_extracted_transactions(user_id, id) ON DELETE SET NULL,
        FOREIGN KEY (user_id, parent_transaction_id) REFERENCES gold_transactions(user_id, id) ON DELETE SET NULL,
        UNIQUE(user_id, id)
      );
    `);

    await this.migrateSourceReceivedAtColumnIfNeeded();


    // 3.1 User Cycles Overrides table
    await this.run(`
      CREATE TABLE IF NOT EXISTS user_cycles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        cycle_name TEXT,
        start_type TEXT NOT NULL CHECK (start_type IN ('default', 'transaction', 'date')),
        start_transaction_id TEXT,
        start_date TEXT NOT NULL,
        start_timestamp TEXT NOT NULL,
        end_date TEXT,
        end_timestamp TEXT,
        created_at TEXT DEFAULT (datetime('now', 'utc')),
        UNIQUE(user_id, start_date)
      );
    `);

    // 3.2 LLM Ingestion Logs: Immutable log of parser output
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
        extracted_transaction_type TEXT DEFAULT 'expense' CHECK (extracted_transaction_type IN ('expense', 'refund', 'transfer', 'fixed')),
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
    await this.run('CREATE INDEX IF NOT EXISTS idx_gold_tx_received_at ON gold_transactions(user_id, source_received_at);');
    await this.run('CREATE INDEX IF NOT EXISTS idx_user_cycles_user ON user_cycles(user_id, start_date);');
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

    // Track user preferences (e.g. if defaults have been seeded to prevent auto-recreating them after deletion)
    await this.run(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY,
        defaults_seeded INTEGER DEFAULT 0
      );
    `);

    // Safe migration: Add billing_cycle_start_day and expected_salary if missing
    const userPrefsInfo = await this.all<{ name: string }>("PRAGMA table_info(user_preferences);");
    const hasCycleStartDay = userPrefsInfo.some(col => col.name === 'billing_cycle_start_day');
    const hasExpectedSalary = userPrefsInfo.some(col => col.name === 'expected_salary');
    
    if (!hasCycleStartDay) {
      await this.run("ALTER TABLE user_preferences ADD COLUMN billing_cycle_start_day INTEGER DEFAULT 17;");
    }
    if (!hasExpectedSalary) {
      await this.run("ALTER TABLE user_preferences ADD COLUMN expected_salary REAL DEFAULT 100000;");
    }

    // 6. Fetcher Emails table
    await this.run(`
      CREATE TABLE IF NOT EXISTS fetcher_emails (
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'utc')),
        PRIMARY KEY (user_id, email)
      );
    `);
    await this.run('CREATE INDEX IF NOT EXISTS idx_fetcher_emails_user ON fetcher_emails(user_id);');

    // 7. Fixed Charges table
    await this.run(`
      CREATE TABLE IF NOT EXISTS fixed_charges (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        category TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        payment_method TEXT,
        created_at TEXT DEFAULT (datetime('now', 'utc'))
      );
    `);
    await this.run('CREATE INDEX IF NOT EXISTS idx_fixed_charges_user ON fixed_charges(user_id);');

    // Safe migration: Add payment_method to fixed_charges if missing
    const fixedChargesInfo = await this.all<{ name: string }>("PRAGMA table_info(fixed_charges);");
    const hasPaymentMethod = fixedChargesInfo.some(col => col.name === 'payment_method');
    if (!hasPaymentMethod) {
      await this.run("ALTER TABLE fixed_charges ADD COLUMN payment_method TEXT;");
    }

    // 8. LLM Feedback Learning tables
    await this.initializeFeedbackSchema();
  }

  private async migrateSourceReceivedAtColumnIfNeeded(): Promise<void> {
    const goldInfo = await this.all<{ name: string }>("PRAGMA table_info(gold_transactions);");
    const hasCol = goldInfo.some(col => col.name === 'source_received_at');
    if (!hasCol) {
      await this.run("ALTER TABLE gold_transactions ADD COLUMN source_received_at TEXT;");
    }
    await this.run(`
      UPDATE gold_transactions
      SET source_received_at = COALESCE(
        (
          SELECT b.received_at
          FROM silver_extracted_transactions s
          JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id
          WHERE s.id = gold_transactions.silver_tx_id
        ),
        transaction_date || 'T00:00:00.000Z'
      )
      WHERE source_received_at IS NULL OR source_received_at = '';
    `);
  }


  /**
   * Detects whether the silver/gold/llm_logs tables were created with the old
   * two-value CHECK constraint ('expense','refund') and, if so, recreates them
   * preserving all rows, so the new 'transfer' value is accepted.
   *
   * IMPORTANT: Foreign keys MUST be disabled before dropping tables so that
   * SQLite does not reject the DROP of silver (referenced by gold). FK enforcement
   * is restored immediately after the migration commits.
   */
  private async migrateTransactionTypeConstraintIfNeeded(): Promise<void> {
    const silverDdl = await this.get<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='silver_extracted_transactions';"
    );
    if (!silverDdl?.sql) return; // Table doesn't exist yet; CREATE IF NOT EXISTS will handle it

    const needsMigration = !silverDdl.sql.includes("'fixed'");
    if (!needsMigration) return;

    // Disable FK enforcement for the duration of the migration.
    // PRAGMA foreign_keys cannot be changed inside a transaction in SQLite,
    // so we set it before BEGIN and restore it after COMMIT/ROLLBACK.
    await this.run('PRAGMA foreign_keys = OFF;');
    await this.run('BEGIN TRANSACTION');
    try {
      // --- Silver ---
      await this.run(`CREATE TABLE silver_extracted_transactions_new (
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
        transaction_type TEXT DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund', 'transfer', 'fixed')),
        parent_transaction_id TEXT,
        deleted_at TEXT,
        extracted_at TEXT DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (user_id, bronze_input_id) REFERENCES bronze_raw_inputs(user_id, id) ON DELETE CASCADE,
        UNIQUE(user_id, bronze_input_id),
        UNIQUE(user_id, id)
      );`);
      await this.run(`INSERT INTO silver_extracted_transactions_new
        SELECT id, user_id, bronze_input_id, source_type, merchant_raw, merchant_normalized,
               amount_cents, currency, transaction_date, inferred_category, confidence_score,
               status, payment_method, transaction_type, parent_transaction_id, deleted_at, extracted_at
        FROM silver_extracted_transactions;`);
      await this.run('DROP TABLE silver_extracted_transactions;');
      await this.run('ALTER TABLE silver_extracted_transactions_new RENAME TO silver_extracted_transactions;');

      // --- Gold ---
      await this.run(`CREATE TABLE gold_transactions_new (
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
        transaction_type TEXT DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund', 'transfer', 'fixed')),
        parent_transaction_id TEXT,
        deleted_at TEXT,
        created_at TEXT DEFAULT (datetime('now', 'utc')),
        updated_at TEXT DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (user_id, silver_tx_id) REFERENCES silver_extracted_transactions(user_id, id) ON DELETE SET NULL,
        FOREIGN KEY (user_id, parent_transaction_id) REFERENCES gold_transactions_new(user_id, id) ON DELETE SET NULL,
        UNIQUE(user_id, id)
      );`);
      await this.run(`INSERT INTO gold_transactions_new
        SELECT id, silver_tx_id, user_id, source_type, merchant, amount_cents, currency,
               transaction_date, category, notes, payment_method, transaction_type,
               parent_transaction_id, deleted_at, created_at, updated_at
        FROM gold_transactions;`);
      await this.run('DROP TABLE gold_transactions;');
      await this.run('ALTER TABLE gold_transactions_new RENAME TO gold_transactions;');

      // --- LLM Extraction Logs ---
      const llmDdl = await this.get<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='llm_extraction_logs';"
      );
      if (llmDdl?.sql && !llmDdl.sql.includes("'fixed'")) {
        await this.run(`CREATE TABLE llm_extraction_logs_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          bronze_input_id TEXT NOT NULL UNIQUE,
          extracted_merchant TEXT,
          extracted_amount_cents INTEGER,
          extracted_currency TEXT,
          extracted_date TEXT,
          extracted_category TEXT,
          extracted_payment_method TEXT,
          extracted_transaction_type TEXT DEFAULT 'expense' CHECK (extracted_transaction_type IN ('expense', 'refund', 'transfer', 'fixed')),
          confidence_score REAL,
          extracted_at TEXT DEFAULT (datetime('now', 'utc')),
          FOREIGN KEY (user_id, bronze_input_id) REFERENCES bronze_raw_inputs(user_id, id) ON DELETE CASCADE,
          UNIQUE(user_id, bronze_input_id),
          UNIQUE(user_id, id)
        );`);
        await this.run(`INSERT INTO llm_extraction_logs_new
          SELECT id, user_id, bronze_input_id, extracted_merchant, extracted_amount_cents,
                 extracted_currency, extracted_date, extracted_category, extracted_payment_method,
                 extracted_transaction_type, confidence_score, extracted_at
          FROM llm_extraction_logs;`);
        await this.run('DROP TABLE llm_extraction_logs;');
        await this.run('ALTER TABLE llm_extraction_logs_new RENAME TO llm_extraction_logs;');
      }

      await this.run('COMMIT');
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    } finally {
      // Always restore FK enforcement after migration, success or failure.
      await this.run('PRAGMA foreign_keys = ON;');
    }
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
    const normalizedCategory = normalizeCategory(tx.inferredCategory);

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
          normalizedCategory,
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
          normalizedCategory,
          tx.paymentMethodRaw || tx.paymentMethod || null,
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
         (id, silver_tx_id, user_id, source_type, merchant, amount_cents, currency, transaction_date, category, notes, payment_method, transaction_type, parent_transaction_id, source_received_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (
           SELECT b.received_at
           FROM silver_extracted_transactions s
           JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id
           WHERE s.id = ?
         ))`,
        [
          tx.id,
          pendingId,
          tx.userId,
          tx.sourceType || 'email',
          tx.merchant,
          amountCents,
          tx.currency,
          tx.transactionDate,
          normalizeCategory(tx.category),
          tx.notes || null,
          tx.paymentMethod || null,
          tx.transactionType || 'expense',
          tx.parentTransactionId || null,
          pendingId,
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
    const sourceReceivedAt = tx.sourceReceivedAt || `${tx.transactionDate}T00:00:00.000Z`;

    await this.run(
      `INSERT OR IGNORE INTO gold_transactions 
       (id, silver_tx_id, user_id, source_type, merchant, amount_cents, currency, transaction_date, category, notes, payment_method, transaction_type, parent_transaction_id, source_received_at) 
       VALUES (?, NULL, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tx.id,
        tx.userId,
        tx.merchant,
        amountCents,
        tx.currency || 'INR',
        tx.transactionDate,
        normalizeCategory(tx.category),
        tx.notes || null,
        tx.paymentMethod,
        tx.transactionType || 'expense',
        tx.parentTransactionId || null,
        sourceReceivedAt,
      ]
    );
  }

  async getRawInputs(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<RawInput[]> {
    let sql = 'SELECT id, user_id, source_type, sender, title, snippet, received_at, has_transaction, status, ingested_at, deleted_at FROM bronze_raw_inputs WHERE user_id = ? AND deleted_at IS NULL';
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
      rawBody: row.raw_body || '',
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

  /**
   * Atomically marks a raw input as rejected AND non-transactional.
   * Calling this ensures the two fields never diverge when a user rejects a record.
   */
  async rejectRawInput(id: string, userId: string): Promise<void> {
    await this.run(
      'UPDATE bronze_raw_inputs SET status = \'rejected\', has_transaction = 0 WHERE id = ? AND user_id = ?',
      [id, userId]
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
      params.push(normalizeCategory(updates.category));
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
      params.push(updates.inferredCategory ? normalizeCategory(updates.inferredCategory) : null);
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

  async rejectRawInputsBatch(ids: string[], userId: string): Promise<void> {
    if (!ids || ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    await this.run(
      `UPDATE bronze_raw_inputs SET status = 'rejected', has_transaction = 0 WHERE id IN (${placeholders}) AND user_id = ?`,
      [...ids, userId]
    );
  }

  async approvePendingTransactionsBatch(silverIds: string[], userId: string): Promise<string[]> {
    if (!silverIds || silverIds.length === 0) return [];
    await this.run('BEGIN TRANSACTION');
    try {
      const approvedIds: string[] = [];
      for (const silverId of silverIds) {
        const tx = await this.getSilverTransactionById(silverId, userId);
        if (tx && tx.status === 'pending') {
          await this.promoteToTransaction(silverId, {
            id: crypto.randomUUID(),
            pendingTxId: silverId,
            userId,
            sourceType: tx.sourceType || 'email',
            merchant: tx.merchantNormalized || tx.merchantRaw,
            amount: tx.amount,
            currency: tx.currency,
            transactionDate: tx.transactionDate,
            category: tx.inferredCategory || 'Other',
            notes: 'Batch approved',
            paymentMethod: tx.paymentMethod,
            transactionType: tx.transactionType || 'expense',
            parentTransactionId: tx.parentTransactionId || undefined,
          });
          approvedIds.push(silverId);
        }
      }
      await this.run('COMMIT');
      return approvedIds;
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
  }

  async updatePendingTransactionsBatch(ids: string[], userId: string, updates: Partial<PendingTransaction>): Promise<void> {
    await this.run('BEGIN TRANSACTION');
    try {
      for (const id of ids) {
        await this.updatePendingTransaction(id, userId, updates);
      }
      await this.run('COMMIT');
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
  }

  async updateGoldTransactionsBatch(ids: string[], userId: string, updates: Partial<Transaction>): Promise<void> {
    await this.run('BEGIN TRANSACTION');
    try {
      for (const id of ids) {
        await this.updateGoldTransaction(id, userId, updates);
      }
      await this.run('COMMIT');
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
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
          'DELETE FROM llm_extraction_logs WHERE bronze_input_id = ? AND user_id = ?',
          [silver.bronzeInputId, userId]
        );
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
    const pref = await this.get<any>(
      'SELECT defaults_seeded FROM user_preferences WHERE user_id = ?',
      [userId]
    );
    const hasSeeded = pref ? pref.defaults_seeded === 1 : false;

    const rows = await this.all<any>(
      'SELECT * FROM payment_methods WHERE user_id = ? ORDER BY name ASC',
      [userId]
    );
    if (!hasSeeded && rows.length === 0) {
      await this.seedDefaultPaymentMethodsAndRules(userId);
      await this.run(
        'INSERT OR REPLACE INTO user_preferences (user_id, defaults_seeded) VALUES (?, 1)',
        [userId]
      );
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
    const rules = await this.getPaymentMappingRules(userId);
    const methods = await this.getPaymentMethods(userId);
    return PaymentStandardizationService.standardize(rawPaymentMethod, rules, methods);
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

  async getFetcherEmails(userId: string): Promise<string[]> {
    const rows = await this.all<{ email: string }>(
      'SELECT email FROM fetcher_emails WHERE user_id = ? ORDER BY email ASC',
      [userId]
    );
    return rows.map(r => r.email);
  }

  async saveFetcherEmail(userId: string, email: string): Promise<void> {
    await this.run(
      'INSERT OR IGNORE INTO fetcher_emails (user_id, email) VALUES (?, ?)',
      [userId, email]
    );
  }

  async deleteFetcherEmail(userId: string, email: string): Promise<void> {
    await this.run(
      'DELETE FROM fetcher_emails WHERE user_id = ? AND email = ?',
      [userId, email]
    );
  }

  async getUserPreferences(userId: string): Promise<{ billingCycleStartDay: number; expectedSalary: number }> {
    const row = await this.get<any>(
      'SELECT billing_cycle_start_day, expected_salary FROM user_preferences WHERE user_id = ?',
      [userId]
    );
    if (!row) {
      return { billingCycleStartDay: 17, expectedSalary: 100000 };
    }
    return {
      billingCycleStartDay: row.billing_cycle_start_day !== null && row.billing_cycle_start_day !== undefined ? row.billing_cycle_start_day : 17,
      expectedSalary: row.expected_salary !== null && row.expected_salary !== undefined ? row.expected_salary : 100000
    };
  }

  async updateUserPreferences(userId: string, cycleStartDay: number, expectedSalary: number): Promise<void> {
    const exists = await this.get<any>(
      'SELECT defaults_seeded FROM user_preferences WHERE user_id = ?',
      [userId]
    );
    if (exists) {
      await this.run(
        'UPDATE user_preferences SET billing_cycle_start_day = ?, expected_salary = ? WHERE user_id = ?',
        [cycleStartDay, expectedSalary, userId]
      );
    } else {
      await this.run(
        'INSERT INTO user_preferences (user_id, defaults_seeded, billing_cycle_start_day, expected_salary) VALUES (?, 0, ?, ?)',
        [userId, cycleStartDay, expectedSalary]
      );
    }
  }

  async getCycleOverrides(userId: string): Promise<any[]> {
    const rows = await this.all<any>(
      'SELECT * FROM user_cycles WHERE user_id = ? ORDER BY start_date DESC',
      [userId]
    );
    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      cycleName: r.cycle_name || undefined,
      startType: r.start_type,
      startTransactionId: r.start_transaction_id || undefined,
      startDate: r.start_date,
      startTimestamp: r.start_timestamp,
      endDate: r.end_date || null,
      endTimestamp: r.end_timestamp || null,
    }));
  }

  async upsertCycleOverride(userId: string, override: any): Promise<void> {
    const id = override.id || `override-${override.startDate}`;
    await this.run(
      `INSERT INTO user_cycles (id, user_id, cycle_name, start_type, start_transaction_id, start_date, start_timestamp, end_date, end_timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, start_date) DO UPDATE SET
         cycle_name = excluded.cycle_name,
         start_type = excluded.start_type,
         start_transaction_id = excluded.start_transaction_id,
         start_timestamp = excluded.start_timestamp,
         end_date = excluded.end_date,
         end_timestamp = excluded.end_timestamp`,
      [
        id,
        userId,
        override.cycleName || null,
        override.startType,
        override.startTransactionId || null,
        override.startDate,
        override.startTimestamp,
        override.endDate || null,
        override.endTimestamp || null,
      ]
    );
  }

  async deleteCycleOverride(userId: string, cycleId: string): Promise<void> {
    await this.run(
      'DELETE FROM user_cycles WHERE user_id = ? AND (id = ? OR start_date = ?)',
      [userId, cycleId, cycleId.replace('default-', '').replace('override-', '')]
    );
  }

  async isCycleStartAnchor(userId: string, transactionId: string): Promise<boolean> {
    const row = await this.get<any>(
      'SELECT id FROM user_cycles WHERE user_id = ? AND start_transaction_id = ?',
      [userId, transactionId]
    );
    return !!row;
  }


  async getFixedCharges(userId: string): Promise<FixedCharge[]> {
    const rows = await this.all<any>(
      'SELECT id, name, amount, currency, category, start_date, end_date, payment_method, created_at FROM fixed_charges WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return rows.map(row => ({
      id: row.id,
      userId: userId,
      name: row.name,
      amount: row.amount,
      currency: row.currency,
      category: row.category,
      startDate: row.start_date,
      endDate: row.end_date,
      paymentMethod: row.payment_method || 'Fixed',
      createdAt: row.created_at,
    }));
  }

  async saveFixedCharge(charge: FixedCharge): Promise<void> {
    const getLocalDateString = () => {
      const d = new Date();
      const offset = d.getTimezoneOffset();
      const localDate = new Date(d.getTime() - (offset * 60 * 1000));
      return localDate.toISOString().split('T')[0];
    };
    const today = getLocalDateString();

    const generateOccurrences = (startStr: string, endStr: string): string[] => {
      const occurrences: string[] = [];
      const [sYear, sMonth, sDay] = startStr.split('-').map(Number);
      const [eYear, eMonth, eDay] = endStr.split('-').map(Number);
      
      let currentYear = sYear;
      let currentMonth = sMonth - 1; // 0-indexed
      
      const endTarget = new Date(Date.UTC(eYear, eMonth - 1, eDay));
      
      while (true) {
        // Get the maximum day for the current month
        const maxDays = new Date(Date.UTC(currentYear, currentMonth + 1, 0)).getUTCDate();
        const actualDay = Math.min(sDay, maxDays);
        
        const currentTarget = new Date(Date.UTC(currentYear, currentMonth, actualDay));
        if (currentTarget > endTarget) {
          break;
        }
        
        occurrences.push(currentTarget.toISOString().split('T')[0]);
        
        // Move to next month
        currentMonth++;
        if (currentMonth > 11) {
          currentMonth = 0;
          currentYear++;
        }
      }
      return occurrences;
    };

    // 1. Check if template exists
    const existing = await this.get<any>(
      'SELECT id, user_id FROM fixed_charges WHERE id = ?',
      [charge.id]
    );

    if (existing && existing.user_id !== charge.userId) {
      throw new Error('Unauthorized access to fixed charge template');
    }

    await this.run('BEGIN TRANSACTION');
    try {
      if (!existing) {
        // --- NEW TEMPLATE ---
        // Insert template
        await this.run(
          `INSERT INTO fixed_charges (id, user_id, name, amount, currency, category, start_date, end_date, payment_method)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [charge.id, charge.userId, charge.name, charge.amount, charge.currency, charge.category, charge.startDate, charge.endDate, charge.paymentMethod || 'Fixed']
        );

        // Generate and insert all occurrences
        const dates = generateOccurrences(charge.startDate, charge.endDate);
        for (const date of dates) {
          await this.run(
            `INSERT INTO gold_transactions (id, silver_tx_id, user_id, source_type, merchant, amount_cents, currency, transaction_date, category, notes, payment_method, transaction_type)
             VALUES (?, NULL, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, 'fixed')`,
            [
              crypto.randomUUID(),
              charge.userId,
              charge.name,
              Math.round(charge.amount * 100),
              charge.currency,
              date,
              normalizeCategory(charge.category),
              `Fixed Charge ID: ${charge.id} | Auto-generated`,
              charge.paymentMethod || 'Fixed'
            ]
          );
        }
      } else {
        // --- EDITED TEMPLATE ---
        // Update template
        await this.run(
          `UPDATE fixed_charges SET name = ?, amount = ?, currency = ?, category = ?, start_date = ?, end_date = ?, payment_method = ?
           WHERE id = ? AND user_id = ?`,
          [charge.name, charge.amount, charge.currency, charge.category, charge.startDate, charge.endDate, charge.paymentMethod || 'Fixed', charge.id, charge.userId]
        );

        // Fetch associated gold transactions matching this fixed charge template
        const associatedTxs = await this.all<any>(
          `SELECT id, transaction_date FROM gold_transactions 
           WHERE user_id = ? AND notes LIKE ?`,
          [charge.userId, `%Fixed Charge ID: ${charge.id}%`]
        );

        // Filter into future and process
        const futureTxs = associatedTxs.filter(tx => tx.transaction_date >= today);

        // Delete future transactions that are beyond the new end date
        for (const tx of futureTxs) {
          if (tx.transaction_date > charge.endDate) {
            await this.run('DELETE FROM gold_transactions WHERE id = ? AND user_id = ?', [tx.id, charge.userId]);
          } else {
            // Update future transactions that are still within range
            await this.run(
              `UPDATE gold_transactions SET merchant = ?, amount_cents = ?, currency = ?, category = ?, payment_method = ?
               WHERE id = ? AND user_id = ?`,
              [
                charge.name,
                Math.round(charge.amount * 100),
                charge.currency,
                normalizeCategory(charge.category),
                charge.paymentMethod || 'Fixed',
                tx.id,
                charge.userId
              ]
            );
          }
        }

        // Generate occurrences and insert missing future transactions
        const theoreticalDates = generateOccurrences(charge.startDate, charge.endDate);
        const futureTheoreticalDates = theoreticalDates.filter(date => date >= today && date >= charge.startDate);

        for (const date of futureTheoreticalDates) {
          const alreadyExists = associatedTxs.some(tx => tx.transaction_date === date);
          if (!alreadyExists) {
            await this.run(
              `INSERT INTO gold_transactions (id, silver_tx_id, user_id, source_type, merchant, amount_cents, currency, transaction_date, category, notes, payment_method, transaction_type)
               VALUES (?, NULL, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, 'fixed')`,
              [
                crypto.randomUUID(),
                charge.userId,
                charge.name,
                Math.round(charge.amount * 100),
                charge.currency,
                date,
                normalizeCategory(charge.category),
                `Fixed Charge ID: ${charge.id} | Auto-generated`,
                charge.paymentMethod || 'Fixed'
              ]
            );
          }
        }
      }
      await this.run('COMMIT');
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
  }

  async deleteFixedCharge(id: string, userId: string): Promise<void> {
    const getLocalDateString = () => {
      const d = new Date();
      const offset = d.getTimezoneOffset();
      const localDate = new Date(d.getTime() - (offset * 60 * 1000));
      return localDate.toISOString().split('T')[0];
    };
    const today = getLocalDateString();

    const existing = await this.get<any>(
      'SELECT id FROM fixed_charges WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    if (!existing) {
      throw new Error('Fixed charge template not found');
    }

    await this.run('BEGIN TRANSACTION');
    try {
      // Delete template
      await this.run(
        'DELETE FROM fixed_charges WHERE id = ? AND user_id = ?',
        [id, userId]
      );

      // Delete only future transactions associated with it
      await this.run(
        `DELETE FROM gold_transactions 
         WHERE user_id = ? AND notes LIKE ? AND transaction_date >= ?`,
        [userId, `%Fixed Charge ID: ${id}%`, today]
      );

      await this.run('COMMIT');
    } catch (err) {
      await this.run('ROLLBACK');
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // IFeedbackRepository implementation
  // ---------------------------------------------------------------------------

  /** Creates the llm_feedback_settings and llm_correction_examples tables. */
  async initializeFeedbackSchema(): Promise<void> {
    await this.run(`
      CREATE TABLE IF NOT EXISTS llm_feedback_settings (
        user_id TEXT PRIMARY KEY,
        is_enabled INTEGER NOT NULL DEFAULT 0,
        max_examples INTEGER NOT NULL DEFAULT 10,
        similarity_threshold REAL DEFAULT 0.3,
        updated_at TEXT DEFAULT (datetime('now', 'utc'))
      );
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS llm_correction_examples (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        bronze_input_id TEXT NOT NULL,
        field_name TEXT NOT NULL CHECK (field_name IN ('merchant', 'category', 'paymentMethod', 'transactionType')),
        llm_value TEXT,
        corrected_value TEXT NOT NULL,
        email_snippet TEXT,
        embedding TEXT,
        created_at TEXT DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (user_id, bronze_input_id) REFERENCES bronze_raw_inputs(user_id, id) ON DELETE CASCADE,
        UNIQUE(user_id, bronze_input_id, field_name)
      );
    `);

    await this.run(
      'CREATE INDEX IF NOT EXISTS idx_correction_examples_user ON llm_correction_examples(user_id, created_at DESC);'
    );

    // Safe migration: check for missing columns dynamically
    const settingsCols = await this.all<{ name: string }>("PRAGMA table_info(llm_feedback_settings);");
    const hasThreshold = settingsCols.some(col => col.name === 'similarity_threshold');
    if (!hasThreshold) {
      await this.run("ALTER TABLE llm_feedback_settings ADD COLUMN similarity_threshold REAL DEFAULT 0.3;");
    }

    const examplesCols = await this.all<{ name: string }>("PRAGMA table_info(llm_correction_examples);");
    const hasEmbedding = examplesCols.some(col => col.name === 'embedding');
    if (!hasEmbedding) {
      await this.run("ALTER TABLE llm_correction_examples ADD COLUMN embedding TEXT;");
    }
  }

  async getFeedbackSettings(userId: string): Promise<FeedbackSettings> {
    const row = await this.get<{ is_enabled: number; max_examples: number; similarity_threshold: number }>(
      'SELECT is_enabled, max_examples, similarity_threshold FROM llm_feedback_settings WHERE user_id = ?',
      [userId]
    );
    if (!row) {
      return { isEnabled: false, maxExamples: 10, similarityThreshold: 0.3 };
    }
    return {
      isEnabled: row.is_enabled === 1,
      maxExamples: row.max_examples,
      similarityThreshold: row.similarity_threshold ?? 0.3
    };
  }

  async saveFeedbackSettings(userId: string, settings: FeedbackSettings): Promise<void> {
    await this.run(
      `INSERT INTO llm_feedback_settings (user_id, is_enabled, max_examples, similarity_threshold, updated_at)
       VALUES (?, ?, ?, ?, datetime('now', 'utc'))
       ON CONFLICT(user_id) DO UPDATE SET
         is_enabled = excluded.is_enabled,
         max_examples = excluded.max_examples,
         similarity_threshold = excluded.similarity_threshold,
         updated_at = excluded.updated_at`,
      [userId, settings.isEnabled ? 1 : 0, settings.maxExamples, settings.similarityThreshold ?? 0.3]
    );
  }

  async upsertCorrectionExample(example: CorrectionExample): Promise<void> {
    await this.run(
      `INSERT INTO llm_correction_examples (id, user_id, bronze_input_id, field_name, llm_value, corrected_value, email_snippet, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'utc'))
       ON CONFLICT(user_id, bronze_input_id, field_name) DO UPDATE SET
         id = excluded.id,
         llm_value = excluded.llm_value,
         corrected_value = excluded.corrected_value,
         email_snippet = excluded.email_snippet,
         embedding = excluded.embedding,
         created_at = excluded.created_at`,
      [example.id, example.userId, example.bronzeInputId, example.fieldName,
       example.llmValue ?? null, example.correctedValue, example.emailSnippet ?? null, example.embedding ?? null]
    );
  }

  async getRecentCorrectionExamples(userId: string, limit: number): Promise<CorrectionExample[]> {
    const rows = await this.all<any>(
      'SELECT * FROM llm_correction_examples WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [userId, limit]
    );
    return rows.map(this.mapRowToCorrectionExample);
  }

  async listCorrectionExamples(userId: string): Promise<CorrectionExample[]> {
    const rows = await this.all<any>(
      'SELECT * FROM llm_correction_examples WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return rows.map(this.mapRowToCorrectionExample);
  }

  async deleteCorrectionExample(id: string, userId: string): Promise<void> {
    await this.run(
      'DELETE FROM llm_correction_examples WHERE id = ? AND user_id = ?',
      [id, userId]
    );
  }

  async clearAllCorrectionExamples(userId: string): Promise<void> {
    await this.run(
      'DELETE FROM llm_correction_examples WHERE user_id = ?',
      [userId]
    );
  }

  async getFeedbackEffectiveness(userId: string): Promise<FeedbackEffectiveness> {
    // 1. Fetch correction examples
    const examples = await this.all<any>(
      'SELECT field_name, created_at FROM llm_correction_examples WHERE user_id = ? ORDER BY created_at ASC',
      [userId]
    );

    const totalExamples = examples.length;
    const byField: Record<string, number> = {
      merchant: 0,
      category: 0,
      paymentMethod: 0,
      transactionType: 0,
    };
    let cutoffDate: string | null = null;
    if (totalExamples > 0) {
      cutoffDate = examples[0].created_at;
      for (const ex of examples) {
        if (byField[ex.field_name] !== undefined) {
          byField[ex.field_name]++;
        }
      }
    }

    // 2. Fetch Gold transactions joined with original LLM logs
    const accuracyRows = await this.all<any>(
      `SELECT 
         g.created_at AS gold_created_at,
         g.merchant, l.extracted_merchant,
         g.category, l.extracted_category,
         g.payment_method, l.extracted_payment_method
       FROM gold_transactions g
       JOIN silver_extracted_transactions s ON g.silver_tx_id = s.id AND g.user_id = s.user_id
       JOIN llm_extraction_logs l ON s.bronze_input_id = l.bronze_input_id AND s.user_id = l.user_id
       WHERE g.user_id = ? AND g.deleted_at IS NULL
       ORDER BY g.created_at ASC`,
      [userId]
    );

    const historicalMissesByField: Record<string, number> = {
      merchant: 0,
      category: 0,
      paymentMethod: 0,
    };

    // Helper for matching checks
    const isMerchantMatch = (row: any) =>
      (row.merchant || '').trim().toLowerCase() === (row.extracted_merchant || '').trim().toLowerCase();

    const isCategoryMatch = (row: any) =>
      (row.category || '').trim().toLowerCase() === (row.extracted_category || '').trim().toLowerCase();

    const isPaymentMethodMatch = (row: any) => {
      const normMethod = (row.payment_method || '').trim().toLowerCase();
      const normExtractedMethod = (row.extracted_payment_method || '').trim().toLowerCase();
      const isMethodEmpty = !normMethod || normMethod === 'unknown' || normMethod === 'n/a';
      const isExtractedEmpty = !normExtractedMethod || normExtractedMethod === 'unknown' || normExtractedMethod === 'n/a';
      return normMethod === normExtractedMethod || (isMethodEmpty && isExtractedEmpty);
    };

    // Count misses
    for (const r of accuracyRows) {
      if (!isMerchantMatch(r)) historicalMissesByField.merchant++;
      if (!isCategoryMatch(r)) historicalMissesByField.category++;
      if (!isPaymentMethodMatch(r)) historicalMissesByField.paymentMethod++;
    }

    // Weekly bucketer
    const getWeekStr = (dateStr: string) => {
      try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return 'unknown';
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        return monday.toISOString().slice(0, 10); // Monday as week label: YYYY-MM-DD
      } catch {
        return 'unknown';
      }
    };

    // Group rows by week
    const weeklyBuckets: Record<string, { merchantM: number; categoryM: number; paymentM: number; total: number }> = {};
    for (const r of accuracyRows) {
      const week = getWeekStr(r.gold_created_at);
      if (week === 'unknown') continue;
      if (!weeklyBuckets[week]) {
        weeklyBuckets[week] = { merchantM: 0, categoryM: 0, paymentM: 0, total: 0 };
      }
      weeklyBuckets[week].total++;
      if (isMerchantMatch(r)) weeklyBuckets[week].merchantM++;
      if (isCategoryMatch(r)) weeklyBuckets[week].categoryM++;
      if (isPaymentMethodMatch(r)) weeklyBuckets[week].paymentM++;
    }

    const weeklyTrend = Object.entries(weeklyBuckets)
      .map(([week, b]) => ({
        week,
        merchantAccuracy: Math.round((b.merchantM / b.total) * 100),
        categoryAccuracy: Math.round((b.categoryM / b.total) * 100),
        paymentMethodAccuracy: Math.round((b.paymentM / b.total) * 100),
        totalRecords: b.total,
      }))
      .sort((a, b) => a.week.localeCompare(b.week));

    // Before/After calculations
    let before: any = null;
    let after: any = null;

    if (cutoffDate) {
      const cutoffTime = new Date(cutoffDate).getTime();
      const beforeRows = accuracyRows.filter(r => new Date(r.gold_created_at).getTime() < cutoffTime);
      const afterRows = accuracyRows.filter(r => new Date(r.gold_created_at).getTime() >= cutoffTime);

      const calculateAccuracy = (rows: any[]) => {
        if (rows.length === 0) return null;
        let merchantM = 0, categoryM = 0, paymentM = 0;
        for (const r of rows) {
          if (isMerchantMatch(r)) merchantM++;
          if (isCategoryMatch(r)) categoryM++;
          if (isPaymentMethodMatch(r)) paymentM++;
        }
        return {
          merchantAccuracy: Math.round((merchantM / rows.length) * 100),
          categoryAccuracy: Math.round((categoryM / rows.length) * 100),
          paymentMethodAccuracy: Math.round((paymentM / rows.length) * 100),
          totalRecords: rows.length,
        };
      };

      before = calculateAccuracy(beforeRows);
      after = calculateAccuracy(afterRows);
    }

    return {
      weeklyTrend,
      beforeAfter: {
        cutoffDate,
        before,
        after,
      },
      coverage: {
        totalExamples,
        byField,
        historicalMissesByField,
      },
    };
  }

  private mapRowToCorrectionExample(row: any): CorrectionExample {
    return {
      id: row.id,
      userId: row.user_id,
      bronzeInputId: row.bronze_input_id,
      fieldName: row.field_name as CorrectionFieldName,
      llmValue: row.llm_value ?? null,
      correctedValue: row.corrected_value,
      emailSnippet: row.email_snippet ?? null,
      embedding: row.embedding ?? null,
      createdAt: row.created_at,
    };
  }

  // ---------------------------------------------------------------------------
  // Database Raw Table Viewer Methods [FUNC-DB-VIEWER]
  // ---------------------------------------------------------------------------

  private static readonly ALLOWED_DB_VIEWER_TABLES = [
    'gold_transactions',
    'silver_extracted_transactions',
    'bronze_raw_inputs',
    'user_cycles',
    'fixed_charges',
    'user_preferences',
    'payment_methods',
    'payment_mapping_rules',
    'llm_extraction_logs',
    'llm_feedback_settings',
    'llm_correction_examples',
    'fetcher_emails'
  ];

  async getInspectableTables(): Promise<Array<{ name: string; columns: string[] }>> {
    const inspectable: Array<{ name: string; columns: string[] }> = [];
    for (const tableName of SQLiteTransactionRepository.ALLOWED_DB_VIEWER_TABLES) {
      try {
        const pragmaRows: any[] = await this.all(`PRAGMA table_info(${tableName})`);
        const columns = pragmaRows.map(r => r.name);
        inspectable.push({ name: tableName, columns });
      } catch (err) {
        // Table might not exist in early schema versions
      }
    }
    return inspectable;
  }

  async getTableRows(
    tableName: string,
    userId: string,
    limit: number = 50,
    offset: number = 0,
    search?: string
  ): Promise<{
    tableName: string;
    columns: string[];
    totalCount: number;
    limit: number;
    offset: number;
    rows: any[];
  }> {
    if (!SQLiteTransactionRepository.ALLOWED_DB_VIEWER_TABLES.includes(tableName)) {
      throw new Error('Invalid or unauthorized table name');
    }

    const pragmaRows: any[] = await this.all(`PRAGMA table_info(${tableName})`);
    const columns = pragmaRows.map(r => r.name);
    const hasUserId = columns.includes('user_id');

    const params: any[] = [];
    let whereClauses: string[] = [];

    if (hasUserId) {
      whereClauses.push('user_id = ?');
      params.push(userId);
    }

    if (search && search.trim() !== '') {
      const searchPattern = `%${search.trim()}%`;
      const searchSubClauses: string[] = [];
      columns.forEach(col => {
        searchSubClauses.push(`CAST(${col} AS TEXT) LIKE ?`);
        params.push(searchPattern);
      });
      whereClauses.push(`(${searchSubClauses.join(' OR ')})`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRow: any = await this.get(`SELECT COUNT(*) as count FROM ${tableName} ${whereSql}`, params);
    const totalCount = countRow ? countRow.count : 0;

    const dataParams = [...params, limit, offset];
    const rows: any[] = await this.all(
      `SELECT * FROM ${tableName} ${whereSql} LIMIT ? OFFSET ?`,
      dataParams
    );

    return {
      tableName,
      columns,
      totalCount,
      limit,
      offset,
      rows
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

