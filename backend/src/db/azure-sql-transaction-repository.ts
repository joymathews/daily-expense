import sql from 'mssql';
import crypto from 'crypto';
import {
  ITransactionRepository,
  RawInput,
  PendingTransaction,
  Transaction,
  PaymentMethod,
  PaymentMappingRule,
  CycleOverrideData,
  FixedCharge
} from './transaction-repository';
import {
  IFeedbackRepository,
  FeedbackSettings,
  CorrectionExample,
  CorrectionFieldName,
  FeedbackEffectiveness
} from './feedback-repository';
import { normalizeCategory } from '../utils/category-helper';
import { PaymentStandardizationService } from '../services/payment-standardization-service';
import { logger } from '../utils/logger';

export class AzureSqlTransactionRepository implements ITransactionRepository, IFeedbackRepository {
  private static instance: AzureSqlTransactionRepository | null = null;
  private pool: sql.ConnectionPool | null = null;
  private poolPromise: Promise<sql.ConnectionPool> | null = null;
  private schemaInitialized = false;

  private constructor() {}

  public static getInstance(): AzureSqlTransactionRepository {
    if (!AzureSqlTransactionRepository.instance) {
      AzureSqlTransactionRepository.instance = new AzureSqlTransactionRepository();
    }
    return AzureSqlTransactionRepository.instance;
  }

  /** Reset singleton instance (useful for testing) */
  public static resetInstance(): void {
    if (AzureSqlTransactionRepository.instance) {
      AzureSqlTransactionRepository.instance.shutdownPool().catch(() => {});
      AzureSqlTransactionRepository.instance = null;
    }
  }

  private async getPool(): Promise<sql.ConnectionPool> {
    if (this.pool && this.pool.connected) {
      return this.pool;
    }

    if (this.poolPromise) {
      return this.poolPromise;
    }

    const config: sql.config = {
      server: process.env.AZURE_SQL_SERVER || 'localhost',
      database: process.env.AZURE_SQL_DATABASE || 'daily_expense_db',
      user: process.env.AZURE_SQL_USER || '',
      password: process.env.AZURE_SQL_PASSWORD || '',
      port: parseInt(process.env.AZURE_SQL_PORT || '1433', 10),
      connectionTimeout: parseInt(process.env.AZURE_SQL_CONNECTION_TIMEOUT || '60000', 10),
      requestTimeout: parseInt(process.env.AZURE_SQL_REQUEST_TIMEOUT || '60000', 10),
      options: {
        encrypt: process.env.AZURE_SQL_ENCRYPT !== 'false',
        trustServerCertificate: process.env.AZURE_SQL_TRUST_SERVER_CERTIFICATE === 'true',
      },
      pool: {
        max: 20,
        min: 2,
        idleTimeoutMillis: 300000,
      },
    };

    logger.info({ server: config.server, database: config.database }, 'Initializing Azure SQL Database connection pool');

    this.poolPromise = sql.connect(config).then(pool => {
      this.pool = pool;
      return pool;
    }).catch(err => {
      this.poolPromise = null;
      logger.error({ err }, 'Failed to connect to Azure SQL Database');
      throw err;
    });

    return this.poolPromise;
  }

  /**
   * Per-request close method. For connection pooling, we keep the pool alive
   * across HTTP request cycles to prevent closing active connections for concurrent requests.
   */
  async close(): Promise<void> {
    return;
  }

  /** Teardown connection pool during application shutdown or test cleanup */
  async shutdownPool(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      this.poolPromise = null;
      this.schemaInitialized = false;
      logger.info('Closed Azure SQL Database connection pool');
    }
  }

  async initializeSchema(): Promise<void> {
    if (this.schemaInitialized) {
      return;
    }

    const pool = await this.getPool();

    // 1. Bronze Table
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'bronze_raw_inputs')
      BEGIN
        CREATE TABLE bronze_raw_inputs (
          id NVARCHAR(255) NOT NULL,
          user_id NVARCHAR(255) NOT NULL,
          source_type NVARCHAR(50) NOT NULL,
          sender NVARCHAR(255) NOT NULL,
          title NVARCHAR(500) NOT NULL,
          snippet NVARCHAR(MAX),
          raw_body NVARCHAR(MAX) NOT NULL,
          raw_payload NVARCHAR(MAX),
          received_at NVARCHAR(50) NOT NULL,
          has_transaction BIT NOT NULL DEFAULT 1,
          status NVARCHAR(50) DEFAULT 'unprocessed' CHECK (status IN ('unprocessed', 'processed', 'rejected')),
          ingested_at DATETIME2 DEFAULT SYSUTCDATETIME(),
          deleted_at NVARCHAR(50),
          CONSTRAINT PK_bronze_raw_inputs PRIMARY KEY (user_id, id)
        );
        CREATE INDEX idx_bronze_inputs_sender ON bronze_raw_inputs(sender);
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_bronze_user_status_date')
          CREATE INDEX idx_bronze_user_status_date ON bronze_raw_inputs(user_id, status, deleted_at, received_at DESC);
      END
    `);

    // 2. Silver Table
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'silver_extracted_transactions')
      BEGIN
        CREATE TABLE silver_extracted_transactions (
          id NVARCHAR(255) NOT NULL PRIMARY KEY,
          user_id NVARCHAR(255) NOT NULL,
          bronze_input_id NVARCHAR(255) NOT NULL,
          source_type NVARCHAR(50) NOT NULL DEFAULT 'email',
          merchant_raw NVARCHAR(255) NOT NULL,
          merchant_normalized NVARCHAR(255),
          amount_cents BIGINT NOT NULL,
          amount DECIMAL(18, 2) NOT NULL,
          currency NVARCHAR(10) NOT NULL,
          transaction_date NVARCHAR(50) NOT NULL,
          inferred_category NVARCHAR(100),
          confidence_score FLOAT,
          status NVARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'error')),
          payment_method NVARCHAR(100),
          transaction_type NVARCHAR(50) DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund', 'transfer', 'fixed')),
          parent_transaction_id NVARCHAR(255),
          deleted_at NVARCHAR(50),
          extracted_at DATETIME2 DEFAULT SYSUTCDATETIME(),
          CONSTRAINT FK_silver_bronze FOREIGN KEY (user_id, bronze_input_id) REFERENCES bronze_raw_inputs(user_id, id) ON DELETE CASCADE,
          CONSTRAINT UQ_silver_user_bronze UNIQUE (user_id, bronze_input_id)
        );
        CREATE INDEX idx_silver_tx_status ON silver_extracted_transactions(status);
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_silver_user_status')
          CREATE INDEX idx_silver_user_status ON silver_extracted_transactions(user_id, deleted_at, status);
      END
    `);

    // 3. Gold Table
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'gold_transactions')
      BEGIN
        CREATE TABLE gold_transactions (
          id NVARCHAR(255) NOT NULL PRIMARY KEY,
          silver_tx_id NVARCHAR(255),
          user_id NVARCHAR(255) NOT NULL,
          source_type NVARCHAR(50) NOT NULL DEFAULT 'email',
          merchant NVARCHAR(255) NOT NULL,
          amount_cents BIGINT NOT NULL,
          amount DECIMAL(18, 2) NOT NULL,
          currency NVARCHAR(10) NOT NULL,
          transaction_date NVARCHAR(50) NOT NULL,
          category NVARCHAR(100) NOT NULL,
          notes NVARCHAR(MAX),
          payment_method NVARCHAR(100),
          transaction_type NVARCHAR(50) DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund', 'transfer', 'fixed')),
          parent_transaction_id NVARCHAR(255),
          source_received_at NVARCHAR(50),
          deleted_at NVARCHAR(50),
          created_at DATETIME2 DEFAULT SYSUTCDATETIME(),
          updated_at DATETIME2 DEFAULT SYSUTCDATETIME()
        );
        CREATE UNIQUE INDEX UQ_gold_user_silver ON gold_transactions(user_id, silver_tx_id) WHERE silver_tx_id IS NOT NULL;
        CREATE INDEX idx_gold_tx_user_date ON gold_transactions(user_id, transaction_date);
        CREATE INDEX idx_gold_tx_received_at ON gold_transactions(user_id, source_received_at);
      END
    `);

    // 4. User Cycles
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'user_cycles')
      BEGIN
        CREATE TABLE user_cycles (
          id NVARCHAR(255) NOT NULL PRIMARY KEY,
          user_id NVARCHAR(255) NOT NULL,
          cycle_name NVARCHAR(100),
          start_type NVARCHAR(50) NOT NULL CHECK (start_type IN ('default', 'transaction', 'date')),
          start_transaction_id NVARCHAR(255),
          start_date NVARCHAR(50) NOT NULL,
          start_timestamp NVARCHAR(50) NOT NULL,
          end_date NVARCHAR(50),
          end_timestamp NVARCHAR(50),
          created_at DATETIME2 DEFAULT SYSUTCDATETIME(),
          CONSTRAINT UQ_user_cycles_start UNIQUE (user_id, start_date)
        );
        CREATE INDEX idx_user_cycles_user ON user_cycles(user_id, start_date);
      END
    `);

    // 5. LLM Extraction Logs
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'llm_extraction_logs')
      BEGIN
        CREATE TABLE llm_extraction_logs (
          id NVARCHAR(255) NOT NULL PRIMARY KEY,
          user_id NVARCHAR(255) NOT NULL,
          bronze_input_id NVARCHAR(255) NOT NULL,
          extracted_merchant NVARCHAR(255),
          extracted_amount_cents BIGINT,
          extracted_currency NVARCHAR(10),
          extracted_date NVARCHAR(50),
          extracted_category NVARCHAR(100),
          extracted_payment_method NVARCHAR(100),
          extracted_transaction_type NVARCHAR(50) DEFAULT 'expense' CHECK (extracted_transaction_type IN ('expense', 'refund', 'transfer', 'fixed')),
          confidence_score FLOAT,
          extracted_at DATETIME2 DEFAULT SYSUTCDATETIME(),
          CONSTRAINT FK_llm_logs_bronze FOREIGN KEY (user_id, bronze_input_id) REFERENCES bronze_raw_inputs(user_id, id) ON DELETE CASCADE,
          CONSTRAINT UQ_llm_logs_bronze UNIQUE (user_id, bronze_input_id)
        );
        CREATE INDEX idx_llm_logs_bronze ON llm_extraction_logs(user_id, bronze_input_id);
      END
    `);

    // 6. Payment Methods & Rules
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'payment_methods')
      BEGIN
        CREATE TABLE payment_methods (
          id NVARCHAR(255) NOT NULL PRIMARY KEY,
          user_id NVARCHAR(255) NOT NULL,
          name NVARCHAR(100) NOT NULL,
          created_at DATETIME2 DEFAULT SYSUTCDATETIME(),
          CONSTRAINT UQ_payment_methods_name UNIQUE (user_id, name)
        );
        CREATE INDEX idx_payment_methods_user ON payment_methods(user_id);
      END
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'payment_mapping_rules')
      BEGIN
        CREATE TABLE payment_mapping_rules (
          id NVARCHAR(255) NOT NULL PRIMARY KEY,
          user_id NVARCHAR(255) NOT NULL,
          alias_pattern NVARCHAR(255) NOT NULL,
          payment_method_id NVARCHAR(255) NOT NULL,
          created_at DATETIME2 DEFAULT SYSUTCDATETIME(),
          CONSTRAINT FK_payment_rules_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE CASCADE,
          CONSTRAINT UQ_payment_rules_pattern UNIQUE (user_id, alias_pattern)
        );
        CREATE INDEX idx_payment_rules_user ON payment_mapping_rules(user_id);
      END
    `);

    // 7. User Preferences
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'user_preferences')
      BEGIN
        CREATE TABLE user_preferences (
          user_id NVARCHAR(255) NOT NULL PRIMARY KEY,
          defaults_seeded BIT DEFAULT 0,
          billing_cycle_start_day INT DEFAULT 17,
          expected_salary DECIMAL(18, 2) DEFAULT 100000.00
        );
      END
    `);

    // 8. Fetcher Emails
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'fetcher_emails')
      BEGIN
        CREATE TABLE fetcher_emails (
          user_id NVARCHAR(255) NOT NULL,
          email NVARCHAR(255) NOT NULL,
          created_at DATETIME2 DEFAULT SYSUTCDATETIME(),
          CONSTRAINT PK_fetcher_emails PRIMARY KEY (user_id, email)
        );
        CREATE INDEX idx_fetcher_emails_user ON fetcher_emails(user_id);
      END
    `);

    // 9. Fixed Charges
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'fixed_charges')
      BEGIN
        CREATE TABLE fixed_charges (
          id NVARCHAR(255) NOT NULL PRIMARY KEY,
          user_id NVARCHAR(255) NOT NULL,
          name NVARCHAR(255) NOT NULL,
          amount DECIMAL(18, 2) NOT NULL,
          currency NVARCHAR(10) NOT NULL DEFAULT 'INR',
          category NVARCHAR(100) NOT NULL,
          start_date NVARCHAR(50) NOT NULL,
          end_date NVARCHAR(50) NOT NULL,
          payment_method NVARCHAR(100),
          created_at DATETIME2 DEFAULT SYSUTCDATETIME()
        );
        CREATE INDEX idx_fixed_charges_user ON fixed_charges(user_id);
      END
    `);

    // 10. Feedback Schema
    await this.initializeFeedbackSchema();
    this.schemaInitialized = true;
  }

  async emailExists(gmailId: string, userId: string): Promise<boolean> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('id', sql.NVarChar(255), gmailId)
      .input('user_id', sql.NVarChar(255), userId)
      .query('SELECT 1 FROM bronze_raw_inputs WHERE id = @id AND user_id = @user_id');
    return (result.recordset.length > 0);
  }

  async saveRawInput(input: RawInput): Promise<void> {
    const pool = await this.getPool();
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

    await pool.request()
      .input('id', sql.NVarChar(255), input.id)
      .input('user_id', sql.NVarChar(255), input.userId)
      .input('source_type', sql.NVarChar(50), input.sourceType || 'email')
      .input('sender', sql.NVarChar(255), input.sender)
      .input('title', sql.NVarChar(500), input.title)
      .input('snippet', sql.NVarChar(sql.MAX), input.snippet || null)
      .input('raw_body', sql.NVarChar(sql.MAX), input.rawBody)
      .input('raw_payload', sql.NVarChar(sql.MAX), input.rawPayload || null)
      .input('received_at', sql.NVarChar(50), input.receivedAt)
      .input('has_transaction', sql.Bit, hasTx)
      .input('status', sql.NVarChar(50), input.status || 'unprocessed')
      .query(`
        IF NOT EXISTS (SELECT 1 FROM bronze_raw_inputs WHERE user_id = @user_id AND id = @id)
        INSERT INTO bronze_raw_inputs (id, user_id, source_type, sender, title, snippet, raw_body, raw_payload, received_at, has_transaction, status)
        VALUES (@id, @user_id, @source_type, @sender, @title, @snippet, @raw_body, @raw_payload, @received_at, @has_transaction, @status)
      `);
  }

  async savePendingTransaction(tx: PendingTransaction): Promise<void> {
    const pool = await this.getPool();
    const amountCents = Math.round(tx.amount * 100);
    await pool.request()
      .input('id', sql.NVarChar(255), tx.id)
      .input('user_id', sql.NVarChar(255), tx.userId)
      .input('bronze_input_id', sql.NVarChar(255), tx.bronzeInputId)
      .input('source_type', sql.NVarChar(50), tx.sourceType || 'email')
      .input('merchant_raw', sql.NVarChar(255), tx.merchantRaw)
      .input('merchant_normalized', sql.NVarChar(255), tx.merchantNormalized || null)
      .input('amount_cents', sql.BigInt, amountCents)
      .input('amount', sql.Decimal(18, 2), tx.amount)
      .input('currency', sql.NVarChar(10), tx.currency)
      .input('transaction_date', sql.NVarChar(50), tx.transactionDate)
      .input('inferred_category', sql.NVarChar(100), tx.inferredCategory ? normalizeCategory(tx.inferredCategory) : null)
      .input('confidence_score', sql.Float, tx.confidenceScore || null)
      .input('status', sql.NVarChar(50), tx.status || 'pending')
      .input('payment_method', sql.NVarChar(100), tx.paymentMethod || null)
      .input('transaction_type', sql.NVarChar(50), tx.transactionType || 'expense')
      .input('parent_transaction_id', sql.NVarChar(255), tx.parentTransactionId || null)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM silver_extracted_transactions WHERE id = @id)
        INSERT INTO silver_extracted_transactions (id, user_id, bronze_input_id, source_type, merchant_raw, merchant_normalized, amount_cents, amount, currency, transaction_date, inferred_category, confidence_score, status, payment_method, transaction_type, parent_transaction_id)
        VALUES (@id, @user_id, @bronze_input_id, @source_type, @merchant_raw, @merchant_normalized, @amount_cents, @amount, @currency, @transaction_date, @inferred_category, @confidence_score, @status, @payment_method, @transaction_type, @parent_transaction_id)
      `);
  }

  async getPendingTransactions(userId: string): Promise<PendingTransaction[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('user_id', sql.NVarChar(255), userId)
      .query(`
        SELECT s.*, b.title as sourceTitle, b.sender as sourceSender, b.received_at as sourceReceivedAt
        FROM silver_extracted_transactions s
        JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
        WHERE s.user_id = @user_id AND s.status IN ('pending', 'error', 'rejected') AND s.deleted_at IS NULL
        ORDER BY s.transaction_date DESC
      `);

    return result.recordset.map(row => this.mapRowToPendingTx(row));
  }

  async promoteToTransaction(pendingId: string, tx: Transaction): Promise<void> {
    const pool = await this.getPool();
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      const pendingRes = await transaction.request()
        .input('pendingId', sql.NVarChar(255), pendingId)
        .input('userId', sql.NVarChar(255), tx.userId)
        .query('SELECT bronze_input_id FROM silver_extracted_transactions WHERE id = @pendingId AND user_id = @userId');

      const bronzeInputId = pendingRes.recordset[0]?.bronze_input_id;

      // 1. Insert into gold
      const amountCents = Math.round(tx.amount * 100);
      await transaction.request()
        .input('id', sql.NVarChar(255), tx.id)
        .input('silver_tx_id', sql.NVarChar(255), pendingId)
        .input('user_id', sql.NVarChar(255), tx.userId)
        .input('source_type', sql.NVarChar(50), tx.sourceType || 'email')
        .input('merchant', sql.NVarChar(255), tx.merchant)
        .input('amount_cents', sql.BigInt, amountCents)
        .input('amount', sql.Decimal(18, 2), tx.amount)
        .input('currency', sql.NVarChar(10), tx.currency)
        .input('transaction_date', sql.NVarChar(50), tx.transactionDate)
        .input('category', sql.NVarChar(100), normalizeCategory(tx.category))
        .input('notes', sql.NVarChar(sql.MAX), tx.notes || null)
        .input('payment_method', sql.NVarChar(100), tx.paymentMethod || null)
        .input('transaction_type', sql.NVarChar(50), tx.transactionType || 'expense')
        .input('parent_transaction_id', sql.NVarChar(255), tx.parentTransactionId || null)
        .input('source_received_at', sql.NVarChar(50), tx.sourceReceivedAt || null)
        .query(`
          INSERT INTO gold_transactions (id, silver_tx_id, user_id, source_type, merchant, amount_cents, amount, currency, transaction_date, category, notes, payment_method, transaction_type, parent_transaction_id, source_received_at)
          VALUES (@id, @silver_tx_id, @user_id, @source_type, @merchant, @amount_cents, @amount, @currency, @transaction_date, @category, @notes, @payment_method, @transaction_type, @parent_transaction_id, @source_received_at)
        `);

      // 2. Update silver status to approved
      await transaction.request()
        .input('pendingId', sql.NVarChar(255), pendingId)
        .input('userId', sql.NVarChar(255), tx.userId)
        .query("UPDATE silver_extracted_transactions SET status = 'approved' WHERE id = @pendingId AND user_id = @userId");

      // 3. Update bronze status to processed
      if (bronzeInputId) {
        await transaction.request()
          .input('bronzeInputId', sql.NVarChar(255), bronzeInputId)
          .input('userId', sql.NVarChar(255), tx.userId)
          .query("UPDATE bronze_raw_inputs SET status = 'processed' WHERE id = @bronzeInputId AND user_id = @userId");
      }

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  async addDirectGoldTransaction(tx: Transaction): Promise<void> {
    const pool = await this.getPool();
    const amountCents = Math.round(tx.amount * 100);
    await pool.request()
      .input('id', sql.NVarChar(255), tx.id)
      .input('user_id', sql.NVarChar(255), tx.userId)
      .input('source_type', sql.NVarChar(50), tx.sourceType || 'manual')
      .input('merchant', sql.NVarChar(255), tx.merchant)
      .input('amount_cents', sql.BigInt, amountCents)
      .input('amount', sql.Decimal(18, 2), tx.amount)
      .input('currency', sql.NVarChar(10), tx.currency)
      .input('transaction_date', sql.NVarChar(50), tx.transactionDate)
      .input('category', sql.NVarChar(100), normalizeCategory(tx.category))
      .input('notes', sql.NVarChar(sql.MAX), tx.notes || null)
      .input('payment_method', sql.NVarChar(100), tx.paymentMethod || null)
      .input('transaction_type', sql.NVarChar(50), tx.transactionType || 'expense')
      .input('parent_transaction_id', sql.NVarChar(255), tx.parentTransactionId || null)
      .input('source_received_at', sql.NVarChar(50), tx.sourceReceivedAt || tx.transactionDate + 'T00:00:00.000Z')
      .query(`
        INSERT INTO gold_transactions (id, silver_tx_id, user_id, source_type, merchant, amount_cents, amount, currency, transaction_date, category, notes, payment_method, transaction_type, parent_transaction_id, source_received_at)
        VALUES (@id, NULL, @user_id, @source_type, @merchant, @amount_cents, @amount, @currency, @transaction_date, @category, @notes, @payment_method, @transaction_type, @parent_transaction_id, @source_received_at)
      `);
  }

  async getRawInputs(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<RawInput[]> {
    const pool = await this.getPool();
    let query = 'SELECT id, user_id, source_type, sender, title, snippet, raw_body, raw_payload, received_at, has_transaction, status, ingested_at, deleted_at FROM bronze_raw_inputs WHERE user_id = @user_id AND deleted_at IS NULL';
    const req = pool.request().input('user_id', sql.NVarChar(255), userId);

    if (filters?.startDate) {
      query += ' AND received_at >= @startDate';
      req.input('startDate', sql.NVarChar(50), filters.startDate);
    }
    if (filters?.endDate) {
      query += ' AND received_at <= @endDate';
      req.input('endDate', sql.NVarChar(50), filters.endDate);
    }

    query += ' ORDER BY received_at DESC';
    const result = await req.query(query);
    return result.recordset.map(row => this.mapRowToRawInput(row));
  }

  async getSilverTransactions(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<PendingTransaction[]> {
    const pool = await this.getPool();
    let query = `
      SELECT s.*, b.title as sourceTitle, b.sender as sourceSender, b.received_at as sourceReceivedAt
      FROM silver_extracted_transactions s
      JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
      WHERE s.user_id = @user_id AND s.deleted_at IS NULL
    `;
    const req = pool.request().input('user_id', sql.NVarChar(255), userId);

    if (filters?.startDate) {
      query += ' AND s.transaction_date >= @startDate';
      req.input('startDate', sql.NVarChar(50), filters.startDate);
    }
    if (filters?.endDate) {
      query += ' AND s.transaction_date <= @endDate';
      req.input('endDate', sql.NVarChar(50), filters.endDate);
    }

    query += ' ORDER BY s.transaction_date DESC';
    const result = await req.query(query);
    return result.recordset.map(row => this.mapRowToPendingTx(row));
  }

  async getGoldTransactions(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<Transaction[]> {
    const pool = await this.getPool();
    let query = `
      SELECT g.*, b.id as bronzeInputId, b.title as sourceTitle, b.sender as sourceSender
      FROM gold_transactions g
      LEFT JOIN silver_extracted_transactions s ON g.silver_tx_id = s.id AND g.user_id = s.user_id
      LEFT JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
      WHERE g.user_id = @user_id AND g.deleted_at IS NULL
    `;
    const req = pool.request().input('user_id', sql.NVarChar(255), userId);

    if (filters?.startDate) {
      query += ' AND g.transaction_date >= @startDate';
      req.input('startDate', sql.NVarChar(50), filters.startDate);
    }
    if (filters?.endDate) {
      query += ' AND g.transaction_date <= @endDate';
      req.input('endDate', sql.NVarChar(50), filters.endDate);
    }

    query += ' ORDER BY g.transaction_date DESC';
    const result = await req.query(query);
    return result.recordset.map(row => this.mapRowToGoldTx(row));
  }

  async rejectRawInput(id: string, userId: string): Promise<void> {
    await this.updateRawInputStatus(id, userId, 'rejected');
  }

  async rejectRawInputsBatch(ids: string[], userId: string): Promise<void> {
    if (!ids || ids.length === 0) return;
    const pool = await this.getPool();
    const req = pool.request().input('userId', sql.NVarChar(255), userId);
    const params: string[] = [];
    ids.forEach((id, index) => {
      const param = `id${index}`;
      params.push(`@${param}`);
      req.input(param, sql.NVarChar(255), id);
    });
    await req.query(`UPDATE bronze_raw_inputs SET status = 'rejected', has_transaction = 0 WHERE id IN (${params.join(', ')}) AND user_id = @userId`);
  }

  async approvePendingTransactionsBatch(silverIds: string[], userId: string): Promise<string[]> {
    if (!silverIds || silverIds.length === 0) return [];
    const pool = await this.getPool();

    const req = pool.request().input('userId', sql.NVarChar(255), userId);
    const paramNames: string[] = [];
    silverIds.forEach((id, index) => {
      const param = `id${index}`;
      paramNames.push(`@${param}`);
      req.input(param, sql.NVarChar(255), id);
    });

    const inClause = paramNames.join(', ');
    const selectQuery = `
      SELECT s.id as pendingId, s.bronze_input_id, s.source_type, s.merchant_raw, s.merchant_normalized,
             s.amount, s.amount_cents, s.currency, s.transaction_date, s.inferred_category, s.payment_method,
             s.transaction_type, s.parent_transaction_id, b.received_at as source_received_at
      FROM silver_extracted_transactions s
      LEFT JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
      WHERE s.id IN (${inClause}) AND s.user_id = @userId AND s.status = 'pending' AND s.deleted_at IS NULL
    `;

    const pendingRes = await req.query(selectQuery);
    const pendingRows = pendingRes.recordset;
    if (pendingRows.length === 0) return [];

    const approvedIds = pendingRows.map(r => r.pendingId);
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      for (const row of pendingRows) {
        const goldId = crypto.randomUUID();
        const merchant = row.merchant_normalized || row.merchant_raw;
        const category = normalizeCategory(row.inferred_category || 'Other');
        const amountCents = row.amount_cents || Math.round(row.amount * 100);

        await transaction.request()
          .input('id', sql.NVarChar(255), goldId)
          .input('silver_tx_id', sql.NVarChar(255), row.pendingId)
          .input('user_id', sql.NVarChar(255), userId)
          .input('source_type', sql.NVarChar(50), row.source_type || 'email')
          .input('merchant', sql.NVarChar(255), merchant)
          .input('amount_cents', sql.BigInt, amountCents)
          .input('amount', sql.Decimal(18, 2), row.amount)
          .input('currency', sql.NVarChar(10), row.currency)
          .input('transaction_date', sql.NVarChar(50), row.transaction_date)
          .input('category', sql.NVarChar(100), category)
          .input('notes', sql.NVarChar(sql.MAX), 'Batch approved')
          .input('payment_method', sql.NVarChar(100), row.payment_method || null)
          .input('transaction_type', sql.NVarChar(50), row.transaction_type || 'expense')
          .input('parent_transaction_id', sql.NVarChar(255), row.parent_transaction_id || null)
          .input('source_received_at', sql.NVarChar(50), row.source_received_at || null)
          .query(`
            INSERT INTO gold_transactions (id, silver_tx_id, user_id, source_type, merchant, amount_cents, amount, currency, transaction_date, category, notes, payment_method, transaction_type, parent_transaction_id, source_received_at)
            VALUES (@id, @silver_tx_id, @user_id, @source_type, @merchant, @amount_cents, @amount, @currency, @transaction_date, @category, @notes, @payment_method, @transaction_type, @parent_transaction_id, @source_received_at)
          `);
      }

      const silverReq = transaction.request().input('userId', sql.NVarChar(255), userId);
      const silverParams: string[] = [];
      approvedIds.forEach((id, index) => {
        const param = `sid${index}`;
        silverParams.push(`@${param}`);
        silverReq.input(param, sql.NVarChar(255), id);
      });
      await silverReq.query(`UPDATE silver_extracted_transactions SET status = 'approved' WHERE id IN (${silverParams.join(', ')}) AND user_id = @userId`);

      const bronzeInputIds = pendingRows.map(r => r.bronze_input_id).filter(Boolean);
      if (bronzeInputIds.length > 0) {
        const bronzeReq = transaction.request().input('userId', sql.NVarChar(255), userId);
        const bronzeParams: string[] = [];
        bronzeInputIds.forEach((id, index) => {
          const param = `bid${index}`;
          bronzeParams.push(`@${param}`);
          bronzeReq.input(param, sql.NVarChar(255), id);
        });
        await bronzeReq.query(`UPDATE bronze_raw_inputs SET status = 'processed' WHERE id IN (${bronzeParams.join(', ')}) AND user_id = @userId`);
      }

      await transaction.commit();
      return approvedIds;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  async updatePendingTransactionsBatch(ids: string[], userId: string, updates: Partial<PendingTransaction>): Promise<void> {
    if (!ids || ids.length === 0) return;
    const pool = await this.getPool();
    const setClauses: string[] = [];
    const req = pool.request().input('user_id', sql.NVarChar(255), userId);

    if (updates.merchantNormalized !== undefined) {
      setClauses.push('merchant_normalized = @merchantNormalized');
      req.input('merchantNormalized', sql.NVarChar(255), updates.merchantNormalized);
    }
    if (updates.merchantRaw !== undefined) {
      setClauses.push('merchant_raw = @merchantRaw');
      req.input('merchantRaw', sql.NVarChar(255), updates.merchantRaw);
    }
    if (updates.amount !== undefined) {
      setClauses.push('amount = @amount');
      setClauses.push('amount_cents = @amount_cents');
      req.input('amount', sql.Decimal(18, 2), updates.amount);
      req.input('amount_cents', sql.BigInt, Math.round(updates.amount * 100));
    }
    if (updates.currency !== undefined) {
      setClauses.push('currency = @currency');
      req.input('currency', sql.NVarChar(10), updates.currency);
    }
    if (updates.transactionDate !== undefined) {
      setClauses.push('transaction_date = @transactionDate');
      req.input('transactionDate', sql.NVarChar(50), updates.transactionDate);
    }
    if (updates.inferredCategory !== undefined) {
      setClauses.push('inferred_category = @inferredCategory');
      req.input('inferredCategory', sql.NVarChar(100), normalizeCategory(updates.inferredCategory));
    }
    if (updates.confidenceScore !== undefined) {
      setClauses.push('confidence_score = @confidenceScore');
      req.input('confidenceScore', sql.Float, updates.confidenceScore);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = @status');
      req.input('status', sql.NVarChar(50), updates.status);
    }
    if (updates.paymentMethod !== undefined) {
      setClauses.push('payment_method = @paymentMethod');
      req.input('paymentMethod', sql.NVarChar(100), updates.paymentMethod || null);
    }
    if (updates.transactionType !== undefined) {
      setClauses.push('transaction_type = @transactionType');
      req.input('transactionType', sql.NVarChar(50), updates.transactionType);
    }

    if (setClauses.length === 0) return;

    const paramNames: string[] = [];
    ids.forEach((id, index) => {
      const param = `id${index}`;
      paramNames.push(`@${param}`);
      req.input(param, sql.NVarChar(255), id);
    });

    await req.query(`UPDATE silver_extracted_transactions SET ${setClauses.join(', ')} WHERE id IN (${paramNames.join(', ')}) AND user_id = @user_id`);
  }

  async updateGoldTransactionsBatch(ids: string[], userId: string, updates: Partial<Transaction>): Promise<void> {
    if (!ids || ids.length === 0) return;
    const pool = await this.getPool();
    const setClauses: string[] = [];
    const req = pool.request().input('user_id', sql.NVarChar(255), userId);

    if (updates.merchant !== undefined) {
      setClauses.push('merchant = @merchant');
      req.input('merchant', sql.NVarChar(255), updates.merchant);
    }
    if (updates.amount !== undefined) {
      setClauses.push('amount = @amount');
      setClauses.push('amount_cents = @amount_cents');
      req.input('amount', sql.Decimal(18, 2), updates.amount);
      req.input('amount_cents', sql.BigInt, Math.round(updates.amount * 100));
    }
    if (updates.currency !== undefined) {
      setClauses.push('currency = @currency');
      req.input('currency', sql.NVarChar(10), updates.currency);
    }
    if (updates.transactionDate !== undefined) {
      setClauses.push('transaction_date = @transactionDate');
      req.input('transactionDate', sql.NVarChar(50), updates.transactionDate);
    }
    if (updates.category !== undefined) {
      setClauses.push('category = @category');
      req.input('category', sql.NVarChar(100), normalizeCategory(updates.category));
    }
    if (updates.notes !== undefined) {
      setClauses.push('notes = @notes');
      req.input('notes', sql.NVarChar(sql.MAX), updates.notes || null);
    }
    if (updates.paymentMethod !== undefined) {
      setClauses.push('payment_method = @paymentMethod');
      req.input('paymentMethod', sql.NVarChar(100), updates.paymentMethod || null);
    }
    if (updates.transactionType !== undefined) {
      setClauses.push('transaction_type = @transactionType');
      req.input('transactionType', sql.NVarChar(50), updates.transactionType);
    }

    if (setClauses.length === 0) return;

    setClauses.push('updated_at = SYSUTCDATETIME()');
    const paramNames: string[] = [];
    ids.forEach((id, index) => {
      const param = `id${index}`;
      paramNames.push(`@${param}`);
      req.input(param, sql.NVarChar(255), id);
    });

    await req.query(`UPDATE gold_transactions SET ${setClauses.join(', ')} WHERE id IN (${paramNames.join(', ')}) AND user_id = @user_id`);
  }

  async updateGoldTransaction(id: string, userId: string, updates: Partial<Transaction>): Promise<void> {
    const pool = await this.getPool();
    const setClauses: string[] = [];
    const req = pool.request()
      .input('id', sql.NVarChar(255), id)
      .input('user_id', sql.NVarChar(255), userId);

    if (updates.merchant !== undefined) {
      setClauses.push('merchant = @merchant');
      req.input('merchant', sql.NVarChar(255), updates.merchant);
    }
    if (updates.amount !== undefined) {
      setClauses.push('amount = @amount');
      setClauses.push('amount_cents = @amount_cents');
      req.input('amount', sql.Decimal(18, 2), updates.amount);
      req.input('amount_cents', sql.BigInt, Math.round(updates.amount * 100));
    }
    if (updates.currency !== undefined) {
      setClauses.push('currency = @currency');
      req.input('currency', sql.NVarChar(10), updates.currency);
    }
    if (updates.transactionDate !== undefined) {
      setClauses.push('transaction_date = @transactionDate');
      req.input('transactionDate', sql.NVarChar(50), updates.transactionDate);
    }
    if (updates.category !== undefined) {
      setClauses.push('category = @category');
      req.input('category', sql.NVarChar(100), normalizeCategory(updates.category));
    }
    if (updates.notes !== undefined) {
      setClauses.push('notes = @notes');
      req.input('notes', sql.NVarChar(sql.MAX), updates.notes || null);
    }
    if (updates.paymentMethod !== undefined) {
      setClauses.push('payment_method = @paymentMethod');
      req.input('paymentMethod', sql.NVarChar(100), updates.paymentMethod || null);
    }
    if (updates.transactionType !== undefined) {
      setClauses.push('transaction_type = @transactionType');
      req.input('transactionType', sql.NVarChar(50), updates.transactionType);
    }

    if (setClauses.length === 0) return;

    setClauses.push('updated_at = SYSUTCDATETIME()');
    await req.query(`UPDATE gold_transactions SET ${setClauses.join(', ')} WHERE id = @id AND user_id = @user_id`);
  }

  async updatePendingTransaction(id: string, userId: string, updates: Partial<PendingTransaction>): Promise<void> {
    const pool = await this.getPool();
    const setClauses: string[] = [];
    const req = pool.request()
      .input('id', sql.NVarChar(255), id)
      .input('user_id', sql.NVarChar(255), userId);

    if (updates.merchantRaw !== undefined) {
      setClauses.push('merchant_raw = @merchantRaw');
      req.input('merchantRaw', sql.NVarChar(255), updates.merchantRaw);
    }
    if (updates.merchantNormalized !== undefined) {
      setClauses.push('merchant_normalized = @merchantNormalized');
      req.input('merchantNormalized', sql.NVarChar(255), updates.merchantNormalized || null);
    }
    if (updates.amount !== undefined) {
      setClauses.push('amount = @amount');
      setClauses.push('amount_cents = @amount_cents');
      req.input('amount', sql.Decimal(18, 2), updates.amount);
      req.input('amount_cents', sql.BigInt, Math.round(updates.amount * 100));
    }
    if (updates.currency !== undefined) {
      setClauses.push('currency = @currency');
      req.input('currency', sql.NVarChar(10), updates.currency);
    }
    if (updates.transactionDate !== undefined) {
      setClauses.push('transaction_date = @transactionDate');
      req.input('transactionDate', sql.NVarChar(50), updates.transactionDate);
    }
    if (updates.inferredCategory !== undefined) {
      setClauses.push('inferred_category = @inferredCategory');
      req.input('inferredCategory', sql.NVarChar(100), normalizeCategory(updates.inferredCategory));
    }
    if (updates.status !== undefined) {
      setClauses.push('status = @status');
      req.input('status', sql.NVarChar(50), updates.status);
    }
    if (updates.paymentMethod !== undefined) {
      setClauses.push('payment_method = @paymentMethod');
      req.input('paymentMethod', sql.NVarChar(100), updates.paymentMethod || null);
    }
    if (updates.transactionType !== undefined) {
      setClauses.push('transaction_type = @transactionType');
      req.input('transactionType', sql.NVarChar(50), updates.transactionType);
    }

    if (setClauses.length === 0) return;

    await req.query(`UPDATE silver_extracted_transactions SET ${setClauses.join(', ')} WHERE id = @id AND user_id = @user_id`);
  }

  async getRawInputById(id: string, userId: string): Promise<RawInput | undefined> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('id', sql.NVarChar(255), id)
      .input('user_id', sql.NVarChar(255), userId)
      .query('SELECT * FROM bronze_raw_inputs WHERE id = @id AND user_id = @user_id AND deleted_at IS NULL');

    if (result.recordset.length === 0) return undefined;
    return this.mapRowToRawInput(result.recordset[0]);
  }

  async updateRawInputClassification(id: string, userId: string, hasTransaction: boolean): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('id', sql.NVarChar(255), id)
      .input('user_id', sql.NVarChar(255), userId)
      .input('has_transaction', sql.Bit, hasTransaction ? 1 : 0)
      .query('UPDATE bronze_raw_inputs SET has_transaction = @has_transaction WHERE id = @id AND user_id = @user_id');
  }

  async updateRawInputStatus(id: string, userId: string, status: 'unprocessed' | 'processed' | 'rejected'): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('id', sql.NVarChar(255), id)
      .input('user_id', sql.NVarChar(255), userId)
      .input('status', sql.NVarChar(50), status)
      .query('UPDATE bronze_raw_inputs SET status = @status WHERE id = @id AND user_id = @user_id');
  }

  async getSilverTransactionByInputId(inputId: string, userId: string): Promise<PendingTransaction | undefined> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('inputId', sql.NVarChar(255), inputId)
      .input('userId', sql.NVarChar(255), userId)
      .query(`
        SELECT s.*, b.title as sourceTitle, b.sender as sourceSender, b.received_at as sourceReceivedAt
        FROM silver_extracted_transactions s
        JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
        WHERE s.bronze_input_id = @inputId AND s.user_id = @userId AND s.deleted_at IS NULL
      `);

    if (result.recordset.length === 0) return undefined;
    return this.mapRowToPendingTx(result.recordset[0]);
  }

  async getSilverTransactionById(id: string, userId: string): Promise<PendingTransaction | undefined> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('id', sql.NVarChar(255), id)
      .input('userId', sql.NVarChar(255), userId)
      .query(`
        SELECT s.*, b.title as sourceTitle, b.sender as sourceSender, b.received_at as sourceReceivedAt
        FROM silver_extracted_transactions s
        JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
        WHERE s.id = @id AND s.user_id = @userId AND s.deleted_at IS NULL
      `);

    if (result.recordset.length === 0) return undefined;
    return this.mapRowToPendingTx(result.recordset[0]);
  }

  async revertGoldToSilver(userId: string, goldId: string): Promise<void> {
    const pool = await this.getPool();
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      const goldRes = await transaction.request()
        .input('goldId', sql.NVarChar(255), goldId)
        .input('userId', sql.NVarChar(255), userId)
        .query('SELECT silver_tx_id, source_type FROM gold_transactions WHERE id = @goldId AND user_id = @userId');

      if (goldRes.recordset.length === 0) {
        await transaction.rollback();
        return;
      }

      const { silver_tx_id, source_type } = goldRes.recordset[0];

      if (source_type === 'manual' || !silver_tx_id) {
        // Direct manual entries soft-delete
        await transaction.request()
          .input('goldId', sql.NVarChar(255), goldId)
          .input('userId', sql.NVarChar(255), userId)
          .query('UPDATE gold_transactions SET deleted_at = SYSUTCDATETIME() WHERE id = @goldId AND user_id = @userId');
      } else {
        // Email transactions hard-delete from gold and reset silver status to pending
        await transaction.request()
          .input('goldId', sql.NVarChar(255), goldId)
          .input('userId', sql.NVarChar(255), userId)
          .query('DELETE FROM gold_transactions WHERE id = @goldId AND user_id = @userId');

        await transaction.request()
          .input('silverId', sql.NVarChar(255), silver_tx_id)
          .input('userId', sql.NVarChar(255), userId)
          .query("UPDATE silver_extracted_transactions SET status = 'pending' WHERE id = @silverId AND user_id = @userId");
      }

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  async revertSilverToBronze(userId: string, silverId: string): Promise<void> {
    const pool = await this.getPool();
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      const silverRes = await transaction.request()
        .input('silverId', sql.NVarChar(255), silverId)
        .input('userId', sql.NVarChar(255), userId)
        .query('SELECT bronze_input_id FROM silver_extracted_transactions WHERE id = @silverId AND user_id = @userId');

      if (silverRes.recordset.length === 0) {
        await transaction.rollback();
        return;
      }

      const bronzeInputId = silverRes.recordset[0].bronze_input_id;

      // Delete from gold, silver, and clear LLM log
      await transaction.request()
        .input('silverId', sql.NVarChar(255), silverId)
        .input('userId', sql.NVarChar(255), userId)
        .query('DELETE FROM gold_transactions WHERE silver_tx_id = @silverId AND user_id = @userId');

      await transaction.request()
        .input('silverId', sql.NVarChar(255), silverId)
        .input('userId', sql.NVarChar(255), userId)
        .query('DELETE FROM silver_extracted_transactions WHERE id = @silverId AND user_id = @userId');

      await transaction.request()
        .input('bronzeInputId', sql.NVarChar(255), bronzeInputId)
        .input('userId', sql.NVarChar(255), userId)
        .query('DELETE FROM llm_extraction_logs WHERE bronze_input_id = @bronzeInputId AND user_id = @userId');

      // Update bronze status to unprocessed
      await transaction.request()
        .input('bronzeInputId', sql.NVarChar(255), bronzeInputId)
        .input('userId', sql.NVarChar(255), userId)
        .query("UPDATE bronze_raw_inputs SET status = 'unprocessed' WHERE id = @bronzeInputId AND user_id = @userId");

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  async deleteBronzeInput(userId: string, bronzeId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('bronzeId', sql.NVarChar(255), bronzeId)
      .input('userId', sql.NVarChar(255), userId)
      .query('UPDATE bronze_raw_inputs SET deleted_at = SYSUTCDATETIME() WHERE id = @bronzeId AND user_id = @userId');
  }

  async restoreBronzeInput(userId: string, bronzeId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('bronzeId', sql.NVarChar(255), bronzeId)
      .input('userId', sql.NVarChar(255), userId)
      .query('UPDATE bronze_raw_inputs SET deleted_at = NULL WHERE id = @bronzeId AND user_id = @userId');
  }

  async getDeletedRawInputs(userId: string): Promise<RawInput[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query('SELECT * FROM bronze_raw_inputs WHERE user_id = @userId AND deleted_at IS NOT NULL ORDER BY received_at DESC');

    return result.recordset.map(row => this.mapRowToRawInput(row));
  }

  async restoreGoldTransaction(userId: string, goldId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('goldId', sql.NVarChar(255), goldId)
      .input('userId', sql.NVarChar(255), userId)
      .query('UPDATE gold_transactions SET deleted_at = NULL WHERE id = @goldId AND user_id = @userId');
  }

  async getDeletedGoldTransactions(userId: string): Promise<Transaction[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query('SELECT * FROM gold_transactions WHERE user_id = @userId AND deleted_at IS NOT NULL ORDER BY transaction_date DESC');

    return result.recordset.map(row => this.mapRowToGoldTx(row));
  }

  async getLlmExtractionLogByBronzeId(bronzeId: string, userId: string): Promise<any | null> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('bronzeId', sql.NVarChar(255), bronzeId)
      .input('userId', sql.NVarChar(255), userId)
      .query('SELECT * FROM llm_extraction_logs WHERE bronze_input_id = @bronzeId AND user_id = @userId');

    if (result.recordset.length === 0) return null;
    const row = result.recordset[0];
    return {
      id: row.id,
      userId: row.user_id,
      bronzeInputId: row.bronze_input_id,
      extractedMerchant: row.extracted_merchant,
      extractedAmountCents: row.extracted_amount_cents,
      extractedCurrency: row.extracted_currency,
      extractedDate: row.extracted_date,
      extractedCategory: row.extracted_category,
      extractedPaymentMethod: row.extracted_payment_method,
      extractedTransactionType: row.extracted_transaction_type,
      confidenceScore: row.confidence_score,
      extractedAt: row.extracted_at,
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
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query(`
        SELECT 
          g.merchant, g.amount_cents, g.category, g.payment_method,
          l.extracted_merchant, l.extracted_amount_cents, l.extracted_category, l.extracted_payment_method
        FROM gold_transactions g
        JOIN silver_extracted_transactions s ON g.silver_tx_id = s.id AND g.user_id = s.user_id
        JOIN llm_extraction_logs l ON s.bronze_input_id = l.bronze_input_id AND g.user_id = l.user_id
        WHERE g.user_id = @userId AND g.deleted_at IS NULL
      `);

    const rows = result.recordset;
    const totalTested = rows.length;
    if (totalTested === 0) {
      return { overallAccuracy: 0, merchantAccuracy: 0, amountAccuracy: 0, categoryAccuracy: 0, paymentMethodAccuracy: 0, totalTested: 0 };
    }

    let merchantMatches = 0;
    let amountMatches = 0;
    let categoryMatches = 0;
    let paymentMethodMatches = 0;

    for (const r of rows) {
      if (r.merchant && r.extracted_merchant && r.merchant.toLowerCase().trim() === r.extracted_merchant.toLowerCase().trim()) merchantMatches++;
      if (r.amount_cents && r.extracted_amount_cents && Number(r.amount_cents) === Number(r.extracted_amount_cents)) amountMatches++;
      if (r.category && r.extracted_category && r.category.toLowerCase().trim() === r.extracted_category.toLowerCase().trim()) categoryMatches++;
      if (r.payment_method && r.extracted_payment_method && r.payment_method.toLowerCase().trim() === r.extracted_payment_method.toLowerCase().trim()) paymentMethodMatches++;
    }

    const merchantAccuracy = Math.round((merchantMatches / totalTested) * 100);
    const amountAccuracy = Math.round((amountMatches / totalTested) * 100);
    const categoryAccuracy = Math.round((categoryMatches / totalTested) * 100);
    const paymentMethodAccuracy = Math.round((paymentMethodMatches / totalTested) * 100);
    const overallAccuracy = Math.round((merchantAccuracy + amountAccuracy + categoryAccuracy + paymentMethodAccuracy) / 4);

    return { overallAccuracy, merchantAccuracy, amountAccuracy, categoryAccuracy, paymentMethodAccuracy, totalTested };
  }

  // Payment method standardization
  async getPaymentMethods(userId: string): Promise<PaymentMethod[]> {
    const pool = await this.getPool();
    
    // Check if user defaults seeded
    const prefsRes = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query('SELECT defaults_seeded FROM user_preferences WHERE user_id = @userId');

    const defaultsSeeded = prefsRes.recordset[0]?.defaults_seeded;

    const methodsRes = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query('SELECT * FROM payment_methods WHERE user_id = @userId ORDER BY name ASC');

    if (methodsRes.recordset.length === 0 && !defaultsSeeded) {
      await this.seedDefaultPaymentMethodsAndRules(userId);
      const reFetch = await pool.request()
        .input('userId', sql.NVarChar(255), userId)
        .query('SELECT * FROM payment_methods WHERE user_id = @userId ORDER BY name ASC');
      return reFetch.recordset.map(row => ({ id: row.id, userId: row.user_id, name: row.name }));
    }

    return methodsRes.recordset.map(row => ({ id: row.id, userId: row.user_id, name: row.name }));
  }

  private async seedDefaultPaymentMethodsAndRules(userId: string): Promise<void> {
    const pool = await this.getPool();
    const defaults = [
      { name: 'Credit Card', aliases: ['credit card', 'cc', 'visa', 'mastercard'] },
      { name: 'UPI', aliases: ['upi', 'gpay', 'phonepe', 'paytm'] },
      { name: 'Debit Card', aliases: ['debit card', 'dc'] },
      { name: 'Net Banking', aliases: ['net banking', 'netbanking', 'neft', 'imps'] },
      { name: 'Cash', aliases: ['cash'] },
    ];

    for (const d of defaults) {
      const pmId = crypto.randomUUID();
      await pool.request()
        .input('id', sql.NVarChar(255), pmId)
        .input('userId', sql.NVarChar(255), userId)
        .input('name', sql.NVarChar(100), d.name)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM payment_methods WHERE user_id = @userId AND name = @name)
          INSERT INTO payment_methods (id, user_id, name) VALUES (@id, @userId, @name)
        `);

      for (const alias of d.aliases) {
        await pool.request()
          .input('ruleId', sql.NVarChar(255), crypto.randomUUID())
          .input('userId', sql.NVarChar(255), userId)
          .input('aliasPattern', sql.NVarChar(255), alias)
          .input('methodId', sql.NVarChar(255), pmId)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM payment_mapping_rules WHERE user_id = @userId AND alias_pattern = @aliasPattern)
            INSERT INTO payment_mapping_rules (id, user_id, alias_pattern, payment_method_id) VALUES (@ruleId, @userId, @aliasPattern, @methodId)
          `);
      }
    }

    await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query(`
        IF EXISTS (SELECT 1 FROM user_preferences WHERE user_id = @userId)
          UPDATE user_preferences SET defaults_seeded = 1 WHERE user_id = @userId
        ELSE
          INSERT INTO user_preferences (user_id, defaults_seeded) VALUES (@userId, 1)
      `);
  }

  async savePaymentMethod(method: PaymentMethod): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('id', sql.NVarChar(255), method.id)
      .input('userId', sql.NVarChar(255), method.userId)
      .input('name', sql.NVarChar(100), method.name)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM payment_methods WHERE id = @id)
        INSERT INTO payment_methods (id, user_id, name) VALUES (@id, @userId, @name)
      `);
  }

  async updatePaymentMethod(id: string, userId: string, name: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('id', sql.NVarChar(255), id)
      .input('userId', sql.NVarChar(255), userId)
      .input('name', sql.NVarChar(100), name)
      .query('UPDATE payment_methods SET name = @name WHERE id = @id AND user_id = @userId');
  }

  async deletePaymentMethod(id: string, userId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('id', sql.NVarChar(255), id)
      .input('userId', sql.NVarChar(255), userId)
      .query('DELETE FROM payment_methods WHERE id = @id AND user_id = @userId');
  }

  async getPaymentMappingRules(userId: string): Promise<PaymentMappingRule[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query(`
        SELECT r.*, m.name as paymentMethodName
        FROM payment_mapping_rules r
        JOIN payment_methods m ON r.payment_method_id = m.id
        WHERE r.user_id = @userId
        ORDER BY r.created_at DESC
      `);

    return result.recordset.map(row => ({
      id: row.id,
      userId: row.user_id,
      aliasPattern: row.alias_pattern,
      paymentMethodId: row.payment_method_id,
      paymentMethodName: row.paymentMethodName,
    }));
  }

  async savePaymentMappingRule(rule: PaymentMappingRule): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('id', sql.NVarChar(255), rule.id)
      .input('userId', sql.NVarChar(255), rule.userId)
      .input('aliasPattern', sql.NVarChar(255), rule.aliasPattern)
      .input('paymentMethodId', sql.NVarChar(255), rule.paymentMethodId)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM payment_mapping_rules WHERE id = @id)
        INSERT INTO payment_mapping_rules (id, user_id, alias_pattern, payment_method_id) VALUES (@id, @userId, @aliasPattern, @paymentMethodId)
      `);
  }

  async updatePaymentMappingRule(id: string, userId: string, aliasPattern: string, methodId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('id', sql.NVarChar(255), id)
      .input('userId', sql.NVarChar(255), userId)
      .input('aliasPattern', sql.NVarChar(255), aliasPattern)
      .input('methodId', sql.NVarChar(255), methodId)
      .query('UPDATE payment_mapping_rules SET alias_pattern = @aliasPattern, payment_method_id = @methodId WHERE id = @id AND user_id = @userId');
  }

  async deletePaymentMappingRule(id: string, userId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('id', sql.NVarChar(255), id)
      .input('userId', sql.NVarChar(255), userId)
      .query('DELETE FROM payment_mapping_rules WHERE id = @id AND user_id = @userId');
  }

  async standardizePaymentMethod(userId: string, rawPaymentMethod: string | undefined): Promise<string> {
    const rules = await this.getPaymentMappingRules(userId);
    const methods = await this.getPaymentMethods(userId);
    return PaymentStandardizationService.standardize(rawPaymentMethod, rules, methods);
  }

  // Fetcher emails
  async getFetcherEmails(userId: string): Promise<string[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query('SELECT email FROM fetcher_emails WHERE user_id = @userId ORDER BY created_at DESC');

    return result.recordset.map(r => r.email);
  }

  async saveFetcherEmail(userId: string, email: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .input('email', sql.NVarChar(255), email.toLowerCase().trim())
      .query(`
        IF NOT EXISTS (SELECT 1 FROM fetcher_emails WHERE user_id = @userId AND email = @email)
        INSERT INTO fetcher_emails (user_id, email) VALUES (@userId, @email)
      `);
  }

  async deleteFetcherEmail(userId: string, email: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .input('email', sql.NVarChar(255), email.toLowerCase().trim())
      .query('DELETE FROM fetcher_emails WHERE user_id = @userId AND email = @email');
  }

  // User preferences
  async getUserPreferences(userId: string): Promise<{ billingCycleStartDay: number; expectedSalary: number }> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query('SELECT billing_cycle_start_day, expected_salary FROM user_preferences WHERE user_id = @userId');

    if (result.recordset.length === 0) {
      return { billingCycleStartDay: 17, expectedSalary: 100000 };
    }
    const row = result.recordset[0];
    return {
      billingCycleStartDay: row.billing_cycle_start_day ?? 17,
      expectedSalary: Number(row.expected_salary ?? 100000),
    };
  }

  async updateUserPreferences(userId: string, cycleStartDay: number, expectedSalary: number): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .input('cycleStartDay', sql.Int, cycleStartDay)
      .input('expectedSalary', sql.Decimal(18, 2), expectedSalary)
      .query(`
        IF EXISTS (SELECT 1 FROM user_preferences WHERE user_id = @userId)
          UPDATE user_preferences SET billing_cycle_start_day = @cycleStartDay, expected_salary = @expectedSalary WHERE user_id = @userId
        ELSE
          INSERT INTO user_preferences (user_id, billing_cycle_start_day, expected_salary) VALUES (@userId, @cycleStartDay, @expectedSalary)
      `);
  }

  // Cycle Overrides
  async getCycleOverrides(userId: string): Promise<CycleOverrideData[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query('SELECT * FROM user_cycles WHERE user_id = @userId ORDER BY start_date ASC');

    return result.recordset.map(row => ({
      id: row.id,
      userId: row.user_id,
      cycleName: row.cycle_name || undefined,
      startType: row.start_type,
      startTransactionId: row.start_transaction_id || undefined,
      startDate: row.start_date,
      startTimestamp: row.start_timestamp,
      endDate: row.end_date || undefined,
      endTimestamp: row.end_timestamp || undefined,
    }));
  }

  async upsertCycleOverride(userId: string, override: CycleOverrideData): Promise<void> {
    const pool = await this.getPool();
    const overrideId = override.id || crypto.randomUUID();

    await pool.request()
      .input('id', sql.NVarChar(255), overrideId)
      .input('userId', sql.NVarChar(255), userId)
      .input('cycleName', sql.NVarChar(100), override.cycleName || null)
      .input('startType', sql.NVarChar(50), override.startType)
      .input('startTransactionId', sql.NVarChar(255), override.startTransactionId || null)
      .input('startDate', sql.NVarChar(50), override.startDate)
      .input('startTimestamp', sql.NVarChar(50), override.startTimestamp)
      .input('endDate', sql.NVarChar(50), override.endDate || null)
      .input('endTimestamp', sql.NVarChar(50), override.endTimestamp || null)
      .query(`
        IF EXISTS (SELECT 1 FROM user_cycles WHERE user_id = @userId AND start_date = @startDate)
          UPDATE user_cycles SET cycle_name = @cycleName, start_type = @startType, start_transaction_id = @startTransactionId, start_timestamp = @startTimestamp, end_date = @endDate, end_timestamp = @endTimestamp WHERE user_id = @userId AND start_date = @startDate
        ELSE
          INSERT INTO user_cycles (id, user_id, cycle_name, start_type, start_transaction_id, start_date, start_timestamp, end_date, end_timestamp)
          VALUES (@id, @userId, @cycleName, @startType, @startTransactionId, @startDate, @startTimestamp, @endDate, @endTimestamp)
      `);
  }

  async deleteCycleOverride(userId: string, cycleId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('cycleId', sql.NVarChar(255), cycleId)
      .input('userId', sql.NVarChar(255), userId)
      .query('DELETE FROM user_cycles WHERE id = @cycleId AND user_id = @userId');
  }

  async isCycleStartAnchor(userId: string, transactionId: string): Promise<boolean> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('transactionId', sql.NVarChar(255), transactionId)
      .input('userId', sql.NVarChar(255), userId)
      .query('SELECT 1 FROM user_cycles WHERE start_transaction_id = @transactionId AND user_id = @userId');

    return result.recordset.length > 0;
  }

  // Fixed Charges
  async getFixedCharges(userId: string): Promise<FixedCharge[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query('SELECT * FROM fixed_charges WHERE user_id = @userId ORDER BY created_at DESC');

    return result.recordset.map(row => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      amount: Number(row.amount),
      currency: row.currency,
      category: row.category,
      startDate: row.start_date,
      endDate: row.end_date,
      paymentMethod: row.payment_method || undefined,
      createdAt: row.created_at,
    }));
  }

  async saveFixedCharge(charge: FixedCharge): Promise<void> {
    const pool = await this.getPool();
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      await transaction.request()
        .input('id', sql.NVarChar(255), charge.id)
        .input('userId', sql.NVarChar(255), charge.userId)
        .input('name', sql.NVarChar(255), charge.name)
        .input('amount', sql.Decimal(18, 2), charge.amount)
        .input('currency', sql.NVarChar(10), charge.currency || 'INR')
        .input('category', sql.NVarChar(100), normalizeCategory(charge.category))
        .input('startDate', sql.NVarChar(50), charge.startDate)
        .input('endDate', sql.NVarChar(50), charge.endDate)
        .input('paymentMethod', sql.NVarChar(100), charge.paymentMethod || null)
        .query(`
          IF EXISTS (SELECT 1 FROM fixed_charges WHERE id = @id AND user_id = @userId)
            UPDATE fixed_charges SET name = @name, amount = @amount, currency = @currency, category = @category, start_date = @startDate, end_date = @endDate, payment_method = @paymentMethod WHERE id = @id AND user_id = @userId
          ELSE
            INSERT INTO fixed_charges (id, user_id, name, amount, currency, category, start_date, end_date, payment_method)
            VALUES (@id, @userId, @name, @amount, @currency, @category, @startDate, @endDate, @paymentMethod)
        `);

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  async deleteFixedCharge(id: string, userId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('id', sql.NVarChar(255), id)
      .input('userId', sql.NVarChar(255), userId)
      .query('DELETE FROM fixed_charges WHERE id = @id AND user_id = @userId');
  }

  // Database Raw Table Viewer Methods
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
    const pool = await this.getPool();
    const inspectable: Array<{ name: string; columns: string[] }> = [];

    for (const tableName of AzureSqlTransactionRepository.ALLOWED_DB_VIEWER_TABLES) {
      try {
        const result = await pool.request()
          .input('tableName', sql.NVarChar(255), tableName)
          .query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = @tableName 
            ORDER BY ORDINAL_POSITION
          `);
        const columns = result.recordset.map(r => r.COLUMN_NAME);
        if (columns.length > 0) {
          inspectable.push({ name: tableName, columns });
        }
      } catch (err) {
        // Table may not exist yet
      }
    }
    return inspectable;
  }

  async getTableRows(
    tableName: string,
    userId: string,
    limit: number,
    offset: number,
    search?: string
  ): Promise<{ rows: any[]; totalCount: number; columns: string[] }> {
    const page = Math.floor(offset / limit) + 1;
    return this.queryRawTableData(tableName, userId, { page, limit, search });
  }

  async queryRawTableData(
    tableName: string,
    userId: string,
    options: { page: number; limit: number; search?: string }
  ): Promise<{ rows: any[]; totalCount: number; columns: string[] }> {
    if (!AzureSqlTransactionRepository.ALLOWED_DB_VIEWER_TABLES.includes(tableName)) {
      throw new Error(`Unauthorized table access: ${tableName}`);
    }

    const pool = await this.getPool();

    // Get column names
    const colResult = await pool.request()
      .input('tableName', sql.NVarChar(255), tableName)
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = @tableName 
        ORDER BY ORDINAL_POSITION
      `);
    const columns = colResult.recordset.map(r => r.COLUMN_NAME);

    const page = Math.max(1, options.page);
    const limit = Math.min(100, Math.max(1, options.limit));
    const offset = (page - 1) * limit;

    const countReq = pool.request().input('userId', sql.NVarChar(255), userId);
    let countQuery = `SELECT COUNT(*) as count FROM ${tableName} WHERE user_id = @userId`;

    if (options.search && columns.length > 0) {
      const searchConditions = columns.map(c => `CAST(${c} AS NVARCHAR(MAX)) LIKE @search`).join(' OR ');
      countQuery += ` AND (${searchConditions})`;
      countReq.input('search', sql.NVarChar(sql.MAX), `%${options.search}%`);
    }

    const countRes = await countReq.query(countQuery);
    const totalCount = countRes.recordset[0]?.count || 0;

    const dataReq = pool.request().input('userId', sql.NVarChar(255), userId);
    let dataQuery = `SELECT * FROM ${tableName} WHERE user_id = @userId`;

    if (options.search && columns.length > 0) {
      const searchConditions = columns.map(c => `CAST(${c} AS NVARCHAR(MAX)) LIKE @search`).join(' OR ');
      dataQuery += ` AND (${searchConditions})`;
      dataReq.input('search', sql.NVarChar(sql.MAX), `%${options.search}%`);
    }

    dataQuery += ` ORDER BY 1 OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

    const dataRes = await dataReq.query(dataQuery);
    return { rows: dataRes.recordset, totalCount, columns };
  }

  // ---------------------------------------------------------------------------
  // IFeedbackRepository implementation
  // ---------------------------------------------------------------------------

  async initializeFeedbackSchema(): Promise<void> {
    const pool = await this.getPool();
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'llm_feedback_settings')
      BEGIN
        CREATE TABLE llm_feedback_settings (
          user_id NVARCHAR(255) NOT NULL PRIMARY KEY,
          is_enabled BIT NOT NULL DEFAULT 0,
          max_examples INT NOT NULL DEFAULT 10,
          similarity_threshold FLOAT DEFAULT 0.3,
          updated_at DATETIME2 DEFAULT SYSUTCDATETIME()
        );
      END
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'llm_correction_examples')
      BEGIN
        CREATE TABLE llm_correction_examples (
          id NVARCHAR(255) NOT NULL PRIMARY KEY,
          user_id NVARCHAR(255) NOT NULL,
          bronze_input_id NVARCHAR(255) NOT NULL,
          field_name NVARCHAR(50) NOT NULL CHECK (field_name IN ('merchant', 'category', 'paymentMethod', 'transactionType')),
          llm_value NVARCHAR(MAX),
          corrected_value NVARCHAR(MAX) NOT NULL,
          email_snippet NVARCHAR(MAX),
          embedding NVARCHAR(MAX),
          created_at DATETIME2 DEFAULT SYSUTCDATETIME(),
          CONSTRAINT FK_correction_examples_bronze FOREIGN KEY (user_id, bronze_input_id) REFERENCES bronze_raw_inputs(user_id, id) ON DELETE CASCADE,
          CONSTRAINT UQ_correction_examples_field UNIQUE (user_id, bronze_input_id, field_name)
        );
        CREATE INDEX idx_correction_examples_user ON llm_correction_examples(user_id, created_at DESC);
      END
    `);
  }

  async getFeedbackSettings(userId: string): Promise<FeedbackSettings> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query('SELECT * FROM llm_feedback_settings WHERE user_id = @userId');

    if (result.recordset.length === 0) {
      return { isEnabled: false, maxExamples: 10, similarityThreshold: 0.3 };
    }

    const row = result.recordset[0];
    return {
      isEnabled: Boolean(row.is_enabled),
      maxExamples: row.max_examples,
      similarityThreshold: row.similarity_threshold ?? 0.3,
    };
  }

  async saveFeedbackSettings(userId: string, settings: FeedbackSettings): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .input('isEnabled', sql.Bit, settings.isEnabled ? 1 : 0)
      .input('maxExamples', sql.Int, settings.maxExamples)
      .input('similarityThreshold', sql.Float, settings.similarityThreshold ?? 0.3)
      .query(`
        IF EXISTS (SELECT 1 FROM llm_feedback_settings WHERE user_id = @userId)
          UPDATE llm_feedback_settings SET is_enabled = @isEnabled, max_examples = @maxExamples, similarity_threshold = @similarityThreshold, updated_at = SYSUTCDATETIME() WHERE user_id = @userId
        ELSE
          INSERT INTO llm_feedback_settings (user_id, is_enabled, max_examples, similarity_threshold) VALUES (@userId, @isEnabled, @maxExamples, @similarityThreshold)
      `);
  }

  async upsertCorrectionExample(example: CorrectionExample): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('id', sql.NVarChar(255), example.id)
      .input('userId', sql.NVarChar(255), example.userId)
      .input('bronzeInputId', sql.NVarChar(255), example.bronzeInputId)
      .input('fieldName', sql.NVarChar(50), example.fieldName)
      .input('llmValue', sql.NVarChar(sql.MAX), example.llmValue || null)
      .input('correctedValue', sql.NVarChar(sql.MAX), example.correctedValue)
      .input('emailSnippet', sql.NVarChar(sql.MAX), example.emailSnippet || null)
      .input('embedding', sql.NVarChar(sql.MAX), example.embedding || null)
      .query(`
        IF EXISTS (SELECT 1 FROM llm_correction_examples WHERE user_id = @userId AND bronze_input_id = @bronzeInputId AND field_name = @fieldName)
          UPDATE llm_correction_examples SET id = @id, llm_value = @llmValue, corrected_value = @correctedValue, email_snippet = @emailSnippet, embedding = @embedding, created_at = SYSUTCDATETIME() WHERE user_id = @userId AND bronze_input_id = @bronzeInputId AND field_name = @fieldName
        ELSE
          INSERT INTO llm_correction_examples (id, user_id, bronze_input_id, field_name, llm_value, corrected_value, email_snippet, embedding)
          VALUES (@id, @userId, @bronzeInputId, @fieldName, @llmValue, @correctedValue, @emailSnippet, @embedding)
      `);
  }

  async getRecentCorrectionExamples(userId: string, limit: number): Promise<CorrectionExample[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .input('limit', sql.Int, Math.max(1, limit))
      .query(`
        SELECT TOP (@limit) * 
        FROM llm_correction_examples 
        WHERE user_id = @userId 
        ORDER BY created_at DESC
      `);

    return result.recordset.map(row => this.mapRowToCorrectionExample(row));
  }

  async listCorrectionExamples(userId: string): Promise<CorrectionExample[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query('SELECT * FROM llm_correction_examples WHERE user_id = @userId ORDER BY created_at DESC');

    return result.recordset.map(row => this.mapRowToCorrectionExample(row));
  }

  async deleteCorrectionExample(id: string, userId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('id', sql.NVarChar(255), id)
      .input('userId', sql.NVarChar(255), userId)
      .query('DELETE FROM llm_correction_examples WHERE id = @id AND user_id = @userId');
  }

  async clearAllCorrectionExamples(userId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query('DELETE FROM llm_correction_examples WHERE user_id = @userId');
  }

  async getFeedbackEffectiveness(userId: string): Promise<FeedbackEffectiveness> {
    const pool = await this.getPool();
    const examplesRes = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query('SELECT field_name, created_at FROM llm_correction_examples WHERE user_id = @userId ORDER BY created_at ASC');

    const examples = examplesRes.recordset;
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

    const accuracyRes = await pool.request()
      .input('userId', sql.NVarChar(255), userId)
      .query(`
        SELECT 
          g.created_at AS gold_created_at,
          g.merchant, l.extracted_merchant,
          g.category, l.extracted_category,
          g.payment_method, l.extracted_payment_method
        FROM gold_transactions g
        JOIN silver_extracted_transactions s ON g.silver_tx_id = s.id AND g.user_id = s.user_id
        JOIN llm_extraction_logs l ON s.bronze_input_id = l.bronze_input_id AND s.user_id = l.user_id
        WHERE g.user_id = @userId AND g.deleted_at IS NULL
        ORDER BY g.created_at ASC
      `);

    const accuracyRows = accuracyRes.recordset;
    const historicalMissesByField: Record<string, number> = {
      merchant: 0,
      category: 0,
      paymentMethod: 0,
    };

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

    for (const r of accuracyRows) {
      if (!isMerchantMatch(r)) historicalMissesByField.merchant++;
      if (!isCategoryMatch(r)) historicalMissesByField.category++;
      if (!isPaymentMethodMatch(r)) historicalMissesByField.paymentMethod++;
    }

    const getWeekStr = (dateStr: string) => {
      try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return 'unknown';
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        return monday.toISOString().slice(0, 10);
      } catch {
        return 'unknown';
      }
    };

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

  // Row Mapping Helpers
  private mapRowToRawInput(row: any): RawInput {
    return {
      id: row.id,
      userId: row.user_id,
      sourceType: row.source_type,
      sender: row.sender,
      title: row.title,
      snippet: row.snippet ?? '',
      rawBody: row.raw_body,
      rawPayload: row.raw_payload ?? '',
      receivedAt: row.received_at,
      hasTransaction: Boolean(row.has_transaction),
      status: row.status,
      ingestedAt: row.ingested_at,
    };
  }

  private mapRowToPendingTx(row: any): PendingTransaction {
    const amountFloat = row.amount !== undefined && row.amount !== null ? Number(row.amount) : Number(row.amount_cents) / 100.0;
    return {
      id: row.id,
      bronzeInputId: row.bronze_input_id,
      userId: row.user_id,
      sourceType: row.source_type,
      merchantRaw: row.merchant_raw,
      merchantNormalized: row.merchant_normalized ?? undefined,
      amount: amountFloat,
      currency: row.currency,
      transactionDate: row.transaction_date,
      inferredCategory: row.inferred_category ?? undefined,
      confidenceScore: row.confidence_score ?? undefined,
      status: row.status,
      extractedAt: row.extracted_at,
      sourceTitle: row.sourceTitle ?? undefined,
      sourceSender: row.sourceSender ?? undefined,
      sourceReceivedAt: row.sourceReceivedAt ?? undefined,
      paymentMethod: row.payment_method ?? undefined,
      transactionType: row.transaction_type ?? 'expense',
      parentTransactionId: row.parent_transaction_id ?? undefined,
    };
  }

  private mapRowToGoldTx(row: any): Transaction {
    const amountFloat = row.amount !== undefined && row.amount !== null ? Number(row.amount) : Number(row.amount_cents) / 100.0;
    return {
      id: row.id,
      pendingTxId: row.silver_tx_id ?? undefined,
      userId: row.user_id,
      sourceType: row.source_type,
      merchant: row.merchant,
      amount: amountFloat,
      currency: row.currency,
      transactionDate: row.transaction_date,
      category: row.category,
      notes: row.notes ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sourceTitle: row.sourceTitle ?? undefined,
      sourceSender: row.sourceSender ?? undefined,
      sourceReceivedAt: row.source_received_at ?? undefined,
      bronzeInputId: row.bronzeInputId ?? undefined,
      paymentMethod: row.payment_method ?? undefined,
      transactionType: row.transaction_type ?? 'expense',
      parentTransactionId: row.parent_transaction_id ?? undefined,
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
}
