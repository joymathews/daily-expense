import { Pool, PoolConfig, PoolClient } from 'pg';
import crypto from 'crypto';
import {
  ITransactionRepository,
  IFeedbackRepository,
  RawInput,
  PendingTransaction,
  Transaction,
  PaymentMethod,
  PaymentMappingRule,
  CycleOverrideData,
  FixedCharge,
  PipelineSummaryStats,
  FeedbackSettings,
  CorrectionExample,
  FeedbackEffectiveness,
  FieldAccuracySnapshot,
  WeeklyAccuracyEntry,
  normalizeCategory
} from '@daily-expense/db-contracts';

export class PostgresTransactionRepository implements ITransactionRepository, IFeedbackRepository {
  private static instance: PostgresTransactionRepository | null = null;
  private pool: Pool | null = null;
  private schemaInitialized = false;

  private constructor() {}

  public static getInstance(): PostgresTransactionRepository {
    if (!PostgresTransactionRepository.instance) {
      PostgresTransactionRepository.instance = new PostgresTransactionRepository();
    }
    return PostgresTransactionRepository.instance;
  }

  public static resetInstance(): void {
    if (PostgresTransactionRepository.instance) {
      PostgresTransactionRepository.instance.shutdownPool().catch(() => {});
      PostgresTransactionRepository.instance = null;
    }
  }

  private getPool(): Pool {
    if (this.pool) {
      return this.pool;
    }

    const config: PoolConfig = {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: process.env.POSTGRES_DB || 'daily_expense_db',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      max: parseInt(process.env.POSTGRES_POOL_MAX || '20', 10),
      idleTimeoutMillis: parseInt(process.env.POSTGRES_IDLE_TIMEOUT_MS || '10000', 10),
      connectionTimeoutMillis: parseInt(process.env.POSTGRES_CONN_TIMEOUT_MS || '10000', 10),
    };

    if (process.env.POSTGRES_SSL === 'true') {
      config.ssl = {
        rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== 'false',
      };
    }

    this.pool = new Pool(config);
    return this.pool;
  }

  public async initializeSchema(): Promise<void> {
    if (this.schemaInitialized) return;
    const { initializePostgresSchema } = require('./postgres-schema');
    await initializePostgresSchema(this.getPool());
    this.schemaInitialized = true;
  }

  public async close(): Promise<void> {
    // Keep pool alive across HTTP requests
    return;
  }

  public async shutdownPool(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.schemaInitialized = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Bronze Layer (Raw Inputs)
  // ---------------------------------------------------------------------------

  async emailExists(gmailId: string, userId: string): Promise<boolean> {
    await this.initializeSchema();
    const query = 'SELECT 1 FROM bronze_raw_inputs WHERE id = $1 AND user_id = $2 LIMIT 1';
    const result = await this.getPool().query(query, [gmailId, userId]);
    return result.rows.length > 0;
  }

  async saveRawInput(input: RawInput): Promise<void> {
    await this.initializeSchema();
    const query = `
      INSERT INTO bronze_raw_inputs (
        id, user_id, source_type, sender, title, snippet,
        raw_body, raw_payload, received_at, has_transaction, status, ingested_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, id) DO UPDATE SET
        title = EXCLUDED.title,
        snippet = EXCLUDED.snippet,
        raw_body = EXCLUDED.raw_body,
        raw_payload = EXCLUDED.raw_payload,
        received_at = EXCLUDED.received_at,
        has_transaction = EXCLUDED.has_transaction;
    `;
    await this.getPool().query(query, [
      input.id,
      input.userId,
      input.sourceType || 'email',
      input.sender,
      input.title,
      input.snippet,
      input.rawBody,
      input.rawPayload,
      input.receivedAt,
      input.hasTransaction !== undefined ? input.hasTransaction : true,
      input.status || 'unprocessed'
    ]);
  }

  async getRawInputs(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<RawInput[]> {
    await this.initializeSchema();
    let query = `
      SELECT 
        id, user_id AS "userId", source_type AS "sourceType", sender, title,
        snippet, raw_body AS "rawBody", raw_payload AS "rawPayload",
        received_at AS "receivedAt", has_transaction AS "hasTransaction",
        status, ingested_at AS "ingestedAt"
      FROM bronze_raw_inputs
      WHERE user_id = $1 AND deleted_at IS NULL
    `;
    const params: any[] = [userId];

    if (filters?.startDate) {
      params.push(filters.startDate);
      query += ` AND received_at >= $${params.length}`;
    }
    if (filters?.endDate) {
      params.push(filters.endDate);
      query += ` AND received_at <= $${params.length}`;
    }

    query += ' ORDER BY received_at DESC';
    const result = await this.getPool().query(query, params);
    return result.rows.map(row => ({
      ...row,
      receivedAt: row.receivedAt ? new Date(row.receivedAt).toISOString() : '',
      ingestedAt: row.ingestedAt ? new Date(row.ingestedAt).toISOString() : ''
    }));
  }

  async getRawInputById(id: string, userId: string): Promise<RawInput | undefined> {
    await this.initializeSchema();
    const query = `
      SELECT 
        id, user_id AS "userId", source_type AS "sourceType", sender, title,
        snippet, raw_body AS "rawBody", raw_payload AS "rawPayload",
        received_at AS "receivedAt", has_transaction AS "hasTransaction",
        status, ingested_at AS "ingestedAt"
      FROM bronze_raw_inputs
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
    `;
    const result = await this.getPool().query(query, [id, userId]);
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0];
    return {
      ...row,
      receivedAt: row.receivedAt ? new Date(row.receivedAt).toISOString() : '',
      ingestedAt: row.ingestedAt ? new Date(row.ingestedAt).toISOString() : ''
    };
  }

  async updateRawInputClassification(id: string, userId: string, hasTransaction: boolean): Promise<void> {
    await this.initializeSchema();
    const query = 'UPDATE bronze_raw_inputs SET has_transaction = $1 WHERE id = $2 AND user_id = $3';
    await this.getPool().query(query, [hasTransaction, id, userId]);
  }

  async updateRawInputStatus(id: string, userId: string, status: 'unprocessed' | 'processed' | 'rejected'): Promise<void> {
    await this.initializeSchema();
    const query = 'UPDATE bronze_raw_inputs SET status = $1 WHERE id = $2 AND user_id = $3';
    await this.getPool().query(query, [status, id, userId]);
  }

  async rejectRawInput(id: string, userId: string): Promise<void> {
    await this.updateRawInputStatus(id, userId, 'rejected');
  }

  async rejectRawInputsBatch(ids: string[], userId: string): Promise<void> {
    if (!ids || ids.length === 0) return;
    await this.initializeSchema();
    const query = 'UPDATE bronze_raw_inputs SET status = $1 WHERE user_id = $2 AND id = ANY($3::text[])';
    await this.getPool().query(query, ['rejected', userId, ids]);
  }

  async deleteBronzeInput(userId: string, bronzeId: string): Promise<void> {
    await this.initializeSchema();
    const query = 'UPDATE bronze_raw_inputs SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2';
    await this.getPool().query(query, [bronzeId, userId]);
  }

  async restoreBronzeInput(userId: string, bronzeId: string): Promise<void> {
    await this.initializeSchema();
    const query = 'UPDATE bronze_raw_inputs SET deleted_at = NULL WHERE id = $1 AND user_id = $2';
    await this.getPool().query(query, [bronzeId, userId]);
  }

  async getDeletedRawInputs(userId: string): Promise<RawInput[]> {
    await this.initializeSchema();
    const query = `
      SELECT 
        id, user_id AS "userId", source_type AS "sourceType", sender, title,
        snippet, raw_body AS "rawBody", raw_payload AS "rawPayload",
        received_at AS "receivedAt", has_transaction AS "hasTransaction",
        status, ingested_at AS "ingestedAt"
      FROM bronze_raw_inputs
      WHERE user_id = $1 AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
    `;
    const result = await this.getPool().query(query, [userId]);
    return result.rows.map(row => ({
      ...row,
      receivedAt: row.receivedAt ? new Date(row.receivedAt).toISOString() : '',
      ingestedAt: row.ingestedAt ? new Date(row.ingestedAt).toISOString() : ''
    }));
  }

  // ---------------------------------------------------------------------------
  // Silver Layer (Extracted Staging Queue)
  // ---------------------------------------------------------------------------

  async savePendingTransaction(tx: PendingTransaction): Promise<void> {
    await this.initializeSchema();
    const amountCents = Math.round(tx.amount * 100);
    const query = `
      INSERT INTO silver_extracted_transactions (
        id, user_id, bronze_input_id, source_type, merchant_raw, merchant_normalized,
        amount_cents, currency, transaction_date, inferred_category, confidence_score,
        status, extracted_at, source_title, source_sender, source_received_at,
        payment_method, payment_method_raw, transaction_type, parent_transaction_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (id) DO UPDATE SET
        merchant_raw = EXCLUDED.merchant_raw,
        merchant_normalized = EXCLUDED.merchant_normalized,
        amount_cents = EXCLUDED.amount_cents,
        currency = EXCLUDED.currency,
        transaction_date = EXCLUDED.transaction_date,
        inferred_category = EXCLUDED.inferred_category,
        confidence_score = EXCLUDED.confidence_score,
        status = EXCLUDED.status,
        payment_method = EXCLUDED.payment_method,
        payment_method_raw = EXCLUDED.payment_method_raw,
        transaction_type = EXCLUDED.transaction_type;
    `;
    await this.getPool().query(query, [
      tx.id,
      tx.userId,
      tx.bronzeInputId,
      tx.sourceType || 'email',
      tx.merchantRaw,
      tx.merchantNormalized || tx.merchantRaw,
      amountCents,
      tx.currency || 'INR',
      tx.transactionDate,
      tx.inferredCategory || 'Other',
      tx.confidenceScore || 1.0,
      tx.status || 'pending',
      tx.sourceTitle || null,
      tx.sourceSender || null,
      tx.sourceReceivedAt || null,
      tx.paymentMethod || 'Unknown',
      tx.paymentMethodRaw || null,
      tx.transactionType || 'expense',
      tx.parentTransactionId || null
    ]);
  }

  async getPendingTransactions(userId: string): Promise<PendingTransaction[]> {
    return this.getSilverTransactions(userId);
  }

  async getSilverTransactions(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<PendingTransaction[]> {
    await this.initializeSchema();
    let query = `
      SELECT 
        s.id, s.bronze_input_id AS "bronzeInputId", s.user_id AS "userId",
        s.source_type AS "sourceType", s.merchant_raw AS "merchantRaw",
        s.merchant_normalized AS "merchantNormalized",
        (s.amount_cents / 100.0) AS amount, s.currency,
        TO_CHAR(s.transaction_date, 'YYYY-MM-DD') AS "transactionDate",
        s.inferred_category AS "inferredCategory", s.confidence_score AS "confidenceScore",
        s.status, s.extracted_at AS "extractedAt",
        b.title AS "sourceTitle", b.sender AS "sourceSender",
        b.received_at AS "sourceReceivedAt",
        s.payment_method AS "paymentMethod", s.payment_method_raw AS "paymentMethodRaw",
        s.transaction_type AS "transactionType", s.parent_transaction_id AS "parentTransactionId"
      FROM silver_extracted_transactions s
      LEFT JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
      WHERE s.user_id = $1
    `;
    const params: any[] = [userId];

    if (filters?.startDate) {
      params.push(filters.startDate);
      query += ` AND s.transaction_date >= $${params.length}`;
    }
    if (filters?.endDate) {
      params.push(filters.endDate);
      query += ` AND s.transaction_date <= $${params.length}`;
    }

    query += ' ORDER BY s.transaction_date DESC';
    const result = await this.getPool().query(query, params);
    return result.rows.map(row => ({
      ...row,
      amount: parseFloat(row.amount),
      extractedAt: row.extractedAt ? new Date(row.extractedAt).toISOString() : '',
      sourceReceivedAt: row.sourceReceivedAt ? new Date(row.sourceReceivedAt).toISOString() : ''
    }));
  }

  async getSilverTransactionById(id: string, userId: string): Promise<PendingTransaction | undefined> {
    await this.initializeSchema();
    const query = `
      SELECT 
        s.id, s.bronze_input_id AS "bronzeInputId", s.user_id AS "userId",
        s.source_type AS "sourceType", s.merchant_raw AS "merchantRaw",
        s.merchant_normalized AS "merchantNormalized",
        (s.amount_cents / 100.0) AS amount, s.currency,
        TO_CHAR(s.transaction_date, 'YYYY-MM-DD') AS "transactionDate",
        s.inferred_category AS "inferredCategory", s.confidence_score AS "confidenceScore",
        s.status, s.extracted_at AS "extractedAt",
        b.title AS "sourceTitle", b.sender AS "sourceSender",
        b.received_at AS "sourceReceivedAt",
        s.payment_method AS "paymentMethod", s.payment_method_raw AS "paymentMethodRaw",
        s.transaction_type AS "transactionType", s.parent_transaction_id AS "parentTransactionId"
      FROM silver_extracted_transactions s
      LEFT JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
      WHERE s.id = $1 AND s.user_id = $2
    `;
    const result = await this.getPool().query(query, [id, userId]);
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0];
    return {
      ...row,
      amount: parseFloat(row.amount),
      extractedAt: row.extractedAt ? new Date(row.extractedAt).toISOString() : '',
      sourceReceivedAt: row.sourceReceivedAt ? new Date(row.sourceReceivedAt).toISOString() : ''
    };
  }

  async getSilverTransactionByInputId(inputId: string, userId: string): Promise<PendingTransaction | undefined> {
    await this.initializeSchema();
    const query = `
      SELECT 
        s.id, s.bronze_input_id AS "bronzeInputId", s.user_id AS "userId",
        s.source_type AS "sourceType", s.merchant_raw AS "merchantRaw",
        s.merchant_normalized AS "merchantNormalized",
        (s.amount_cents / 100.0) AS amount, s.currency,
        TO_CHAR(s.transaction_date, 'YYYY-MM-DD') AS "transactionDate",
        s.inferred_category AS "inferredCategory", s.confidence_score AS "confidenceScore",
        s.status, s.extracted_at AS "extractedAt",
        b.title AS "sourceTitle", b.sender AS "sourceSender",
        b.received_at AS "sourceReceivedAt",
        s.payment_method AS "paymentMethod", s.payment_method_raw AS "paymentMethodRaw",
        s.transaction_type AS "transactionType", s.parent_transaction_id AS "parentTransactionId"
      FROM silver_extracted_transactions s
      LEFT JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
      WHERE s.bronze_input_id = $1 AND s.user_id = $2
      LIMIT 1
    `;
    const result = await this.getPool().query(query, [inputId, userId]);
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0];
    return {
      ...row,
      amount: parseFloat(row.amount),
      extractedAt: row.extractedAt ? new Date(row.extractedAt).toISOString() : '',
      sourceReceivedAt: row.sourceReceivedAt ? new Date(row.sourceReceivedAt).toISOString() : ''
    };
  }

  async updatePendingTransaction(id: string, userId: string, updates: Partial<PendingTransaction>): Promise<void> {
    await this.initializeSchema();
    const setClauses: string[] = [];
    const params: any[] = [id, userId];

    if (updates.merchantRaw !== undefined) {
      params.push(updates.merchantRaw);
      setClauses.push(`merchant_raw = $${params.length}`);
    }
    if (updates.merchantNormalized !== undefined) {
      params.push(updates.merchantNormalized);
      setClauses.push(`merchant_normalized = $${params.length}`);
    }
    if (updates.amount !== undefined) {
      params.push(Math.round(updates.amount * 100));
      setClauses.push(`amount_cents = $${params.length}`);
    }
    if (updates.currency !== undefined) {
      params.push(updates.currency);
      setClauses.push(`currency = $${params.length}`);
    }
    if (updates.transactionDate !== undefined) {
      params.push(updates.transactionDate);
      setClauses.push(`transaction_date = $${params.length}`);
    }
    if (updates.inferredCategory !== undefined) {
      params.push(normalizeCategory(updates.inferredCategory));
      setClauses.push(`inferred_category = $${params.length}`);
    }
    if (updates.status !== undefined) {
      params.push(updates.status);
      setClauses.push(`status = $${params.length}`);
    }
    if (updates.paymentMethod !== undefined) {
      params.push(updates.paymentMethod);
      setClauses.push(`payment_method = $${params.length}`);
    }
    if (updates.transactionType !== undefined) {
      params.push(updates.transactionType);
      setClauses.push(`transaction_type = $${params.length}`);
    }

    if (setClauses.length === 0) return;

    const query = `
      UPDATE silver_extracted_transactions
      SET ${setClauses.join(', ')}
      WHERE id = $1 AND user_id = $2
    `;
    await this.getPool().query(query, params);
  }

  async updatePendingTransactionsBatch(ids: string[], userId: string, updates: Partial<PendingTransaction>): Promise<void> {
    if (!ids || ids.length === 0) return;
    await this.initializeSchema();
    const setClauses: string[] = [];
    const params: any[] = [userId, ids];

    if (updates.status !== undefined) {
      params.push(updates.status);
      setClauses.push(`status = $${params.length}`);
    }
    if (updates.inferredCategory !== undefined) {
      params.push(normalizeCategory(updates.inferredCategory));
      setClauses.push(`inferred_category = $${params.length}`);
    }
    if (updates.paymentMethod !== undefined) {
      params.push(updates.paymentMethod);
      setClauses.push(`payment_method = $${params.length}`);
    }

    if (setClauses.length === 0) return;

    const query = `
      UPDATE silver_extracted_transactions
      SET ${setClauses.join(', ')}
      WHERE user_id = $1 AND id = ANY($2::text[])
    `;
    await this.getPool().query(query, params);
  }

  // ---------------------------------------------------------------------------
  // Gold Layer (Confirmed Ledger)
  // ---------------------------------------------------------------------------

  async promoteToTransaction(pendingId: string, tx: Transaction): Promise<void> {
    await this.initializeSchema();
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      const amountCents = Math.round(tx.amount * 100);

      // 1. Insert into gold_transactions
      const insertGold = `
        INSERT INTO gold_transactions (
          id, pending_tx_id, user_id, source_type, merchant, amount_cents, currency,
          transaction_date, category, notes, created_at, updated_at,
          source_title, source_sender, source_received_at, bronze_input_id,
          payment_method, transaction_type, parent_transaction_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (id) DO UPDATE SET
          merchant = EXCLUDED.merchant,
          amount_cents = EXCLUDED.amount_cents,
          currency = EXCLUDED.currency,
          transaction_date = EXCLUDED.transaction_date,
          category = EXCLUDED.category,
          notes = EXCLUDED.notes,
          updated_at = CURRENT_TIMESTAMP,
          payment_method = EXCLUDED.payment_method,
          transaction_type = EXCLUDED.transaction_type;
      `;
      await client.query(insertGold, [
        tx.id,
        pendingId || null,
        tx.userId,
        tx.sourceType || 'email',
        tx.merchant,
        amountCents,
        tx.currency || 'INR',
        tx.transactionDate,
        normalizeCategory(tx.category),
        tx.notes || null,
        tx.sourceTitle || null,
        tx.sourceSender || null,
        tx.sourceReceivedAt || null,
        tx.bronzeInputId || null,
        tx.paymentMethod || 'Unknown',
        tx.transactionType || 'expense',
        tx.parentTransactionId || null
      ]);

      // 2. Mark Silver as approved
      if (pendingId) {
        await client.query(
          "UPDATE silver_extracted_transactions SET status = 'approved' WHERE id = $1 AND user_id = $2",
          [pendingId, tx.userId]
        );
      }

      // 3. Mark Bronze as processed
      if (tx.bronzeInputId) {
        await client.query(
          "UPDATE bronze_raw_inputs SET status = 'processed' WHERE id = $1 AND user_id = $2",
          [tx.bronzeInputId, tx.userId]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async addDirectGoldTransaction(tx: Transaction): Promise<void> {
    await this.initializeSchema();
    const amountCents = Math.round(tx.amount * 100);
    const query = `
      INSERT INTO gold_transactions (
        id, pending_tx_id, user_id, source_type, merchant, amount_cents, currency,
        transaction_date, category, notes, created_at, updated_at,
        source_title, source_sender, source_received_at, bronze_input_id,
        payment_method, transaction_type, parent_transaction_id
      ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $10, $11, $12, $13, $14, $15, $16);
    `;
    await this.getPool().query(query, [
      tx.id,
      tx.userId,
      tx.sourceType || 'manual',
      tx.merchant,
      amountCents,
      tx.currency || 'INR',
      tx.transactionDate,
      normalizeCategory(tx.category),
      tx.notes || null,
      tx.sourceTitle || null,
      tx.sourceSender || null,
      tx.sourceReceivedAt || null,
      tx.bronzeInputId || null,
      tx.paymentMethod || 'Manual',
      tx.transactionType || 'expense',
      tx.parentTransactionId || null
    ]);
  }

  async approvePendingTransactionsBatch(silverIds: string[], userId: string): Promise<string[]> {
    if (!silverIds || silverIds.length === 0) return [];
    await this.initializeSchema();
    const client = await this.getPool().connect();
    const goldIds: string[] = [];

    try {
      await client.query('BEGIN');

      // Fetch all silver records
      const silverQuery = `
        SELECT 
          s.id, s.bronze_input_id AS "bronzeInputId", s.user_id AS "userId",
          s.source_type AS "sourceType", s.merchant_normalized AS merchant,
          s.amount_cents AS "amountCents", s.currency,
          TO_CHAR(s.transaction_date, 'YYYY-MM-DD') AS "transactionDate",
          s.inferred_category AS category,
          b.title AS "sourceTitle", b.sender AS "sourceSender",
          b.received_at AS "sourceReceivedAt",
          s.payment_method AS "paymentMethod", s.transaction_type AS "transactionType"
        FROM silver_extracted_transactions s
        LEFT JOIN bronze_raw_inputs b ON s.bronze_input_id = b.id AND s.user_id = b.user_id
        WHERE s.user_id = $1 AND s.id = ANY($2::text[]) AND s.status = 'pending'
      `;
      const result = await client.query(silverQuery, [userId, silverIds]);

      for (const row of result.rows) {
        const goldId = crypto.randomUUID();
        goldIds.push(goldId);

        await client.query(
          `INSERT INTO gold_transactions (
            id, pending_tx_id, user_id, source_type, merchant, amount_cents, currency,
            transaction_date, category, notes, created_at, updated_at,
            source_title, source_sender, source_received_at, bronze_input_id,
            payment_method, transaction_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $10, $11, $12, $13, $14, $15)`,
          [
            goldId,
            row.id,
            userId,
            row.sourceType || 'email',
            row.merchant,
            row.amountCents,
            row.currency,
            row.transactionDate,
            normalizeCategory(row.category),
            row.sourceTitle,
            row.sourceSender,
            row.sourceReceivedAt,
            row.bronzeInputId,
            row.paymentMethod || 'Unknown',
            row.transactionType || 'expense'
          ]
        );

        await client.query(
          "UPDATE silver_extracted_transactions SET status = 'approved' WHERE id = $1 AND user_id = $2",
          [row.id, userId]
        );

        if (row.bronzeInputId) {
          await client.query(
            "UPDATE bronze_raw_inputs SET status = 'processed' WHERE id = $1 AND user_id = $2",
            [row.bronzeInputId, userId]
          );
        }
      }

      await client.query('COMMIT');
      return goldIds;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getGoldTransactions(userId: string, filters?: { startDate?: string; endDate?: string }): Promise<Transaction[]> {
    await this.initializeSchema();
    let query = `
      SELECT 
        id, pending_tx_id AS "pendingTxId", user_id AS "userId",
        source_type AS "sourceType", merchant,
        (amount_cents / 100.0) AS amount, currency,
        TO_CHAR(transaction_date, 'YYYY-MM-DD') AS "transactionDate",
        category, notes, created_at AS "createdAt", updated_at AS "updatedAt",
        source_title AS "sourceTitle", source_sender AS "sourceSender",
        source_received_at AS "sourceReceivedAt", bronze_input_id AS "bronzeInputId",
        payment_method AS "paymentMethod", transaction_type AS "transactionType",
        parent_transaction_id AS "parentTransactionId"
      FROM gold_transactions
      WHERE user_id = $1 AND deleted_at IS NULL
    `;
    const params: any[] = [userId];

    if (filters?.startDate) {
      params.push(filters.startDate);
      query += ` AND transaction_date >= $${params.length}`;
    }
    if (filters?.endDate) {
      params.push(filters.endDate);
      query += ` AND transaction_date <= $${params.length}`;
    }

    query += ' ORDER BY transaction_date DESC';
    const result = await this.getPool().query(query, params);
    return result.rows.map(row => ({
      ...row,
      amount: parseFloat(row.amount),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : '',
      sourceReceivedAt: row.sourceReceivedAt ? new Date(row.sourceReceivedAt).toISOString() : ''
    }));
  }

  async updateGoldTransaction(id: string, userId: string, updates: Partial<Transaction>): Promise<void> {
    await this.initializeSchema();
    const setClauses: string[] = [];
    const params: any[] = [id, userId];

    if (updates.merchant !== undefined) {
      params.push(updates.merchant);
      setClauses.push(`merchant = $${params.length}`);
    }
    if (updates.amount !== undefined) {
      params.push(Math.round(updates.amount * 100));
      setClauses.push(`amount_cents = $${params.length}`);
    }
    if (updates.currency !== undefined) {
      params.push(updates.currency);
      setClauses.push(`currency = $${params.length}`);
    }
    if (updates.transactionDate !== undefined) {
      params.push(updates.transactionDate);
      setClauses.push(`transaction_date = $${params.length}`);
    }
    if (updates.category !== undefined) {
      params.push(normalizeCategory(updates.category));
      setClauses.push(`category = $${params.length}`);
    }
    if (updates.notes !== undefined) {
      params.push(updates.notes);
      setClauses.push(`notes = $${params.length}`);
    }
    if (updates.paymentMethod !== undefined) {
      params.push(updates.paymentMethod);
      setClauses.push(`payment_method = $${params.length}`);
    }
    if (updates.transactionType !== undefined) {
      params.push(updates.transactionType);
      setClauses.push(`transaction_type = $${params.length}`);
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');

    const query = `
      UPDATE gold_transactions
      SET ${setClauses.join(', ')}
      WHERE id = $1 AND user_id = $2
    `;
    await this.getPool().query(query, params);
  }

  async updateGoldTransactionsBatch(ids: string[], userId: string, updates: Partial<Transaction>): Promise<void> {
    if (!ids || ids.length === 0) return;
    await this.initializeSchema();
    const setClauses: string[] = [];
    const params: any[] = [userId, ids];

    if (updates.category !== undefined) {
      params.push(normalizeCategory(updates.category));
      setClauses.push(`category = $${params.length}`);
    }
    if (updates.paymentMethod !== undefined) {
      params.push(updates.paymentMethod);
      setClauses.push(`payment_method = $${params.length}`);
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');

    const query = `
      UPDATE gold_transactions
      SET ${setClauses.join(', ')}
      WHERE user_id = $1 AND id = ANY($2::text[])
    `;
    await this.getPool().query(query, params);
  }

  async restoreGoldTransaction(userId: string, goldId: string): Promise<void> {
    await this.initializeSchema();
    const query = 'UPDATE gold_transactions SET deleted_at = NULL WHERE id = $1 AND user_id = $2';
    await this.getPool().query(query, [goldId, userId]);
  }

  async getDeletedGoldTransactions(userId: string): Promise<Transaction[]> {
    await this.initializeSchema();
    const query = `
      SELECT 
        id, pending_tx_id AS "pendingTxId", user_id AS "userId",
        source_type AS "sourceType", merchant,
        (amount_cents / 100.0) AS amount, currency,
        TO_CHAR(transaction_date, 'YYYY-MM-DD') AS "transactionDate",
        category, notes, created_at AS "createdAt", updated_at AS "updatedAt",
        source_title AS "sourceTitle", source_sender AS "sourceSender",
        source_received_at AS "sourceReceivedAt", bronze_input_id AS "bronzeInputId",
        payment_method AS "paymentMethod", transaction_type AS "transactionType",
        parent_transaction_id AS "parentTransactionId"
      FROM gold_transactions
      WHERE user_id = $1 AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
    `;
    const result = await this.getPool().query(query, [userId]);
    return result.rows.map(row => ({
      ...row,
      amount: parseFloat(row.amount),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
    }));
  }

  async revertGoldToSilver(userId: string, goldId: string): Promise<void> {
    await this.initializeSchema();
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      const selectQuery = `
        SELECT id, pending_tx_id AS "pendingTxId", source_type AS "sourceType", bronze_input_id AS "bronzeInputId"
        FROM gold_transactions
        WHERE id = $1 AND user_id = $2
      `;
      const result = await client.query(selectQuery, [goldId, userId]);
      if (result.rows.length === 0) {
        await client.query('COMMIT');
        return;
      }

      const gold = result.rows[0];

      if (gold.sourceType === 'manual') {
        // Soft delete manual gold entries
        await client.query(
          'UPDATE gold_transactions SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2',
          [goldId, userId]
        );
      } else {
        // Delete gold transaction
        await client.query('DELETE FROM gold_transactions WHERE id = $1 AND user_id = $2', [goldId, userId]);

        // Revert silver to pending
        if (gold.pendingTxId) {
          await client.query(
            "UPDATE silver_extracted_transactions SET status = 'pending' WHERE id = $1 AND user_id = $2",
            [gold.pendingTxId, userId]
          );
        }

        // Revert bronze to unprocessed
        if (gold.bronzeInputId) {
          await client.query(
            "UPDATE bronze_raw_inputs SET status = 'unprocessed' WHERE id = $1 AND user_id = $2",
            [gold.bronzeInputId, userId]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async revertSilverToBronze(userId: string, silverId: string): Promise<void> {
    await this.initializeSchema();
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      const selectQuery = `
        SELECT bronze_input_id AS "bronzeInputId"
        FROM silver_extracted_transactions
        WHERE id = $1 AND user_id = $2
      `;
      const result = await client.query(selectQuery, [silverId, userId]);

      if (result.rows.length > 0) {
        const bronzeInputId = result.rows[0].bronzeInputId;
        await client.query('DELETE FROM silver_extracted_transactions WHERE id = $1 AND user_id = $2', [silverId, userId]);
        if (bronzeInputId) {
          await client.query(
            "UPDATE bronze_raw_inputs SET status = 'unprocessed' WHERE id = $1 AND user_id = $2",
            [bronzeInputId, userId]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Pipeline Summary Stats (Lightweight Scalar Aggregations)
  // ---------------------------------------------------------------------------

  async getPipelineSummaryStats(userId: string): Promise<PipelineSummaryStats> {
    await this.initializeSchema();
    const query = `
      SELECT
        (SELECT COUNT(*) FROM bronze_raw_inputs WHERE user_id = $1 AND deleted_at IS NULL) AS bronze_count,
        (SELECT COUNT(*) FROM bronze_raw_inputs WHERE user_id = $1 AND status = 'processed' AND deleted_at IS NULL) AS bronze_processed,
        (SELECT COUNT(*) FROM bronze_raw_inputs WHERE user_id = $1 AND status = 'unprocessed' AND deleted_at IS NULL) AS bronze_unprocessed,
        (SELECT COUNT(*) FROM bronze_raw_inputs WHERE user_id = $1 AND status = 'rejected' AND deleted_at IS NULL) AS bronze_rejected,
        (SELECT COUNT(*) FROM silver_extracted_transactions WHERE user_id = $1 AND status = 'pending') AS silver_count,
        (SELECT COUNT(*) FROM silver_extracted_transactions WHERE user_id = $1 AND status = 'rejected') AS silver_rejected,
        (SELECT COUNT(*) FROM gold_transactions WHERE user_id = $1 AND deleted_at IS NULL) AS gold_count,
        COALESCE((SELECT SUM(amount_cents) FROM gold_transactions WHERE user_id = $1 AND deleted_at IS NULL), 0) AS gold_cents
    `;
    const result = await this.getPool().query(query, [userId]);
    const row = result.rows[0];

    return {
      bronzeCount: parseInt(row.bronze_count, 10) || 0,
      bronzeProcessedCount: parseInt(row.bronze_processed, 10) || 0,
      bronzeUnprocessedCount: parseInt(row.bronze_unprocessed, 10) || 0,
      bronzeRejectedCount: parseInt(row.bronze_rejected, 10) || 0,
      silverCount: parseInt(row.silver_count, 10) || 0,
      silverRejectedCount: parseInt(row.silver_rejected, 10) || 0,
      goldCount: parseInt(row.gold_count, 10) || 0,
      goldTotalAmount: (parseInt(row.gold_cents, 10) || 0) / 100.0
    };
  }

  // ---------------------------------------------------------------------------
  // Payment Standardization Methods
  // ---------------------------------------------------------------------------

  async getPaymentMethods(userId: string): Promise<PaymentMethod[]> {
    await this.initializeSchema();
    const query = 'SELECT id, user_id AS "userId", name FROM payment_methods WHERE user_id = $1 ORDER BY name ASC';
    const result = await this.getPool().query(query, [userId]);
    return result.rows;
  }

  async savePaymentMethod(method: PaymentMethod): Promise<void> {
    await this.initializeSchema();
    const query = `
      INSERT INTO payment_methods (id, user_id, name, created_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, name) DO NOTHING
    `;
    await this.getPool().query(query, [method.id, method.userId, method.name]);
  }

  async updatePaymentMethod(id: string, userId: string, name: string): Promise<void> {
    await this.initializeSchema();
    const query = 'UPDATE payment_methods SET name = $1 WHERE id = $2 AND user_id = $3';
    await this.getPool().query(query, [name, id, userId]);
  }

  async deletePaymentMethod(id: string, userId: string): Promise<void> {
    await this.initializeSchema();
    const query = 'DELETE FROM payment_methods WHERE id = $1 AND user_id = $2';
    await this.getPool().query(query, [id, userId]);
  }

  async getPaymentMappingRules(userId: string): Promise<PaymentMappingRule[]> {
    await this.initializeSchema();
    const query = `
      SELECT 
        r.id, r.user_id AS "userId", r.alias_pattern AS "aliasPattern",
        r.payment_method_id AS "paymentMethodId", m.name AS "paymentMethodName"
      FROM payment_mapping_rules r
      LEFT JOIN payment_methods m ON r.payment_method_id = m.id AND r.user_id = m.user_id
      WHERE r.user_id = $1
      ORDER BY r.created_at ASC
    `;
    const result = await this.getPool().query(query, [userId]);
    return result.rows;
  }

  async savePaymentMappingRule(rule: PaymentMappingRule): Promise<void> {
    await this.initializeSchema();
    const query = `
      INSERT INTO payment_mapping_rules (id, user_id, alias_pattern, payment_method_id, created_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, alias_pattern) DO UPDATE SET
        payment_method_id = EXCLUDED.payment_method_id;
    `;
    await this.getPool().query(query, [rule.id, rule.userId, rule.aliasPattern, rule.paymentMethodId]);
  }

  async updatePaymentMappingRule(id: string, userId: string, aliasPattern: string, methodId: string): Promise<void> {
    await this.initializeSchema();
    const query = 'UPDATE payment_mapping_rules SET alias_pattern = $1, payment_method_id = $2 WHERE id = $3 AND user_id = $4';
    await this.getPool().query(query, [aliasPattern, methodId, id, userId]);
  }

  async deletePaymentMappingRule(id: string, userId: string): Promise<void> {
    await this.initializeSchema();
    const query = 'DELETE FROM payment_mapping_rules WHERE id = $1 AND user_id = $2';
    await this.getPool().query(query, [id, userId]);
  }

  async standardizePaymentMethod(userId: string, rawPaymentMethod: string | undefined): Promise<string> {
    if (!rawPaymentMethod) return 'Unknown';
    const trimmed = rawPaymentMethod.trim();
    if (!trimmed) return 'Unknown';

    const rules = await this.getPaymentMappingRules(userId);
    for (const rule of rules) {
      if (trimmed.toLowerCase().includes(rule.aliasPattern.toLowerCase())) {
        return rule.paymentMethodName || trimmed;
      }
    }
    return trimmed;
  }

  // ---------------------------------------------------------------------------
  // Fetcher Emails & User Preferences
  // ---------------------------------------------------------------------------

  async getFetcherEmails(userId: string): Promise<string[]> {
    await this.initializeSchema();
    const query = 'SELECT email FROM fetcher_emails WHERE user_id = $1 ORDER BY email ASC';
    const result = await this.getPool().query(query, [userId]);
    return result.rows.map(r => r.email);
  }

  async saveFetcherEmail(userId: string, email: string): Promise<void> {
    await this.initializeSchema();
    const query = 'INSERT INTO fetcher_emails (user_id, email) VALUES ($1, $2) ON CONFLICT (user_id, email) DO NOTHING';
    await this.getPool().query(query, [userId, email]);
  }

  async deleteFetcherEmail(userId: string, email: string): Promise<void> {
    await this.initializeSchema();
    const query = 'DELETE FROM fetcher_emails WHERE user_id = $1 AND email = $2';
    await this.getPool().query(query, [userId, email]);
  }

  async getUserPreferences(userId: string): Promise<{ billingCycleStartDay: number; expectedSalary: number }> {
    await this.initializeSchema();
    const query = 'SELECT billing_cycle_start_day AS "billingCycleStartDay", expected_salary AS "expectedSalary" FROM user_preferences WHERE user_id = $1';
    const result = await this.getPool().query(query, [userId]);
    if (result.rows.length === 0) {
      return { billingCycleStartDay: 1, expectedSalary: 0.00 };
    }
    return {
      billingCycleStartDay: result.rows[0].billingCycleStartDay,
      expectedSalary: parseFloat(result.rows[0].expectedSalary) || 0.00
    };
  }

  async updateUserPreferences(userId: string, cycleStartDay: number, expectedSalary: number): Promise<void> {
    await this.initializeSchema();
    const query = `
      INSERT INTO user_preferences (user_id, billing_cycle_start_day, expected_salary, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        billing_cycle_start_day = EXCLUDED.billing_cycle_start_day,
        expected_salary = EXCLUDED.expected_salary,
        updated_at = CURRENT_TIMESTAMP;
    `;
    await this.getPool().query(query, [userId, cycleStartDay, expectedSalary]);
  }

  // ---------------------------------------------------------------------------
  // Cycle Overrides & Fixed Charges
  // ---------------------------------------------------------------------------

  async getCycleOverrides(userId: string): Promise<CycleOverrideData[]> {
    await this.initializeSchema();
    const query = `
      SELECT 
        id, user_id AS "userId", cycle_name AS "cycleName",
        start_type AS "startType", start_transaction_id AS "startTransactionId",
        TO_CHAR(start_date, 'YYYY-MM-DD') AS "startDate",
        start_timestamp AS "startTimestamp",
        TO_CHAR(end_date, 'YYYY-MM-DD') AS "endDate",
        end_timestamp AS "endTimestamp"
      FROM cycle_override
      WHERE user_id = $1
      ORDER BY start_date DESC
    `;
    const result = await this.getPool().query(query, [userId]);
    return result.rows.map(row => ({
      ...row,
      startTimestamp: row.startTimestamp ? new Date(row.startTimestamp).toISOString() : '',
      endTimestamp: row.endTimestamp ? new Date(row.endTimestamp).toISOString() : null
    }));
  }

  async upsertCycleOverride(userId: string, override: CycleOverrideData): Promise<void> {
    await this.initializeSchema();
    const id = override.id || crypto.randomUUID();
    const query = `
      INSERT INTO cycle_override (
        id, user_id, cycle_name, start_type, start_transaction_id,
        start_date, start_timestamp, end_date, end_timestamp, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        cycle_name = EXCLUDED.cycle_name,
        start_type = EXCLUDED.start_type,
        start_transaction_id = EXCLUDED.start_transaction_id,
        start_date = EXCLUDED.start_date,
        start_timestamp = EXCLUDED.start_timestamp,
        end_date = EXCLUDED.end_date,
        end_timestamp = EXCLUDED.end_timestamp;
    `;
    await this.getPool().query(query, [
      id,
      userId,
      override.cycleName || null,
      override.startType || 'default',
      override.startTransactionId || null,
      override.startDate,
      override.startTimestamp,
      override.endDate || null,
      override.endTimestamp || null
    ]);
  }

  async deleteCycleOverride(userId: string, cycleId: string): Promise<void> {
    await this.initializeSchema();
    const query = 'DELETE FROM cycle_override WHERE id = $1 AND user_id = $2';
    await this.getPool().query(query, [cycleId, userId]);
  }

  async isCycleStartAnchor(userId: string, transactionId: string): Promise<boolean> {
    await this.initializeSchema();
    const query = 'SELECT 1 FROM cycle_override WHERE user_id = $1 AND start_transaction_id = $2 LIMIT 1';
    const result = await this.getPool().query(query, [userId, transactionId]);
    return result.rows.length > 0;
  }

  async getFixedCharges(userId: string): Promise<FixedCharge[]> {
    await this.initializeSchema();
    const query = `
      SELECT 
        id, user_id AS "userId", name,
        (amount_cents / 100.0) AS amount, currency, category,
        TO_CHAR(start_date, 'YYYY-MM-DD') AS "startDate",
        TO_CHAR(end_date, 'YYYY-MM-DD') AS "endDate",
        payment_method AS "paymentMethod", created_at AS "createdAt"
      FROM fixed_charges
      WHERE user_id = $1
      ORDER BY start_date DESC
    `;
    const result = await this.getPool().query(query, [userId]);
    return result.rows.map(row => ({
      ...row,
      amount: parseFloat(row.amount),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : ''
    }));
  }

  async saveFixedCharge(charge: FixedCharge): Promise<void> {
    await this.initializeSchema();
    const amountCents = Math.round(charge.amount * 100);
    const query = `
      INSERT INTO fixed_charges (
        id, user_id, name, amount_cents, currency, category,
        start_date, end_date, payment_method, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        amount_cents = EXCLUDED.amount_cents,
        currency = EXCLUDED.currency,
        category = EXCLUDED.category,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        payment_method = EXCLUDED.payment_method;
    `;
    await this.getPool().query(query, [
      charge.id,
      charge.userId,
      charge.name,
      amountCents,
      charge.currency || 'INR',
      normalizeCategory(charge.category),
      charge.startDate,
      charge.endDate,
      charge.paymentMethod || null
    ]);
  }

  async deleteFixedCharge(id: string, userId: string): Promise<void> {
    await this.initializeSchema();
    const query = 'DELETE FROM fixed_charges WHERE id = $1 AND user_id = $2';
    await this.getPool().query(query, [id, userId]);
  }

  // ---------------------------------------------------------------------------
  // LLM Accuracy Stats & Logs
  // ---------------------------------------------------------------------------

  async getLlmExtractionLogByBronzeId(bronzeId: string, userId: string): Promise<any | null> {
    await this.initializeSchema();
    const query = `
      SELECT id, user_id AS "userId", bronze_input_id AS "bronzeInputId",
             raw_email_snippet AS "rawEmailSnippet", extracted_json AS "extractedJson",
             model_name AS "modelName", latency_ms AS "latencyMs",
             created_at AS "createdAt"
      FROM llm_extraction_logs
      WHERE bronze_input_id = $1 AND user_id = $2
      ORDER BY created_at DESC LIMIT 1
    `;
    const result = await this.getPool().query(query, [bronzeId, userId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  async getLlmAccuracyStats(userId: string): Promise<{
    overallAccuracy: number;
    merchantAccuracy: number;
    amountAccuracy: number;
    categoryAccuracy: number;
    paymentMethodAccuracy: number;
    totalTested: number;
  }> {
    await this.initializeSchema();
    const query = `
      SELECT 
        COUNT(*) AS total_tested,
        COUNT(CASE WHEN s.merchant_normalized = g.merchant THEN 1 END) AS merchant_correct,
        COUNT(CASE WHEN s.amount_cents = g.amount_cents THEN 1 END) AS amount_correct,
        COUNT(CASE WHEN s.inferred_category = g.category THEN 1 END) AS category_correct,
        COUNT(CASE WHEN s.payment_method = g.payment_method THEN 1 END) AS payment_correct
      FROM gold_transactions g
      JOIN silver_extracted_transactions s ON g.pending_tx_id = s.id AND g.user_id = s.user_id
      WHERE g.user_id = $1 AND g.deleted_at IS NULL
    `;
    const result = await this.getPool().query(query, [userId]);
    const row = result.rows[0];
    const total = parseInt(row.total_tested, 10) || 0;

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

    const merchantAcc = Math.round((parseInt(row.merchant_correct, 10) / total) * 100);
    const amountAcc = Math.round((parseInt(row.amount_correct, 10) / total) * 100);
    const categoryAcc = Math.round((parseInt(row.category_correct, 10) / total) * 100);
    const paymentAcc = Math.round((parseInt(row.payment_correct, 10) / total) * 100);
    const overall = Math.round((merchantAcc + amountAcc + categoryAcc + paymentAcc) / 4);

    return {
      overallAccuracy: overall,
      merchantAccuracy: merchantAcc,
      amountAccuracy: amountAcc,
      categoryAccuracy: categoryAcc,
      paymentMethodAccuracy: paymentAcc,
      totalTested: total
    };
  }

  // ---------------------------------------------------------------------------
  // Feedback Repository Implementation
  // ---------------------------------------------------------------------------

  async getFeedbackSettings(userId: string): Promise<FeedbackSettings> {
    await this.initializeSchema();
    const query = 'SELECT is_enabled AS "isEnabled", max_examples AS "maxExamples", similarity_threshold AS "similarityThreshold" FROM feedback_settings WHERE user_id = $1';
    const result = await this.getPool().query(query, [userId]);
    if (result.rows.length === 0) {
      return { isEnabled: false, maxExamples: 10, similarityThreshold: 0.70 };
    }
    return {
      isEnabled: result.rows[0].isEnabled,
      maxExamples: result.rows[0].maxExamples,
      similarityThreshold: parseFloat(result.rows[0].similarityThreshold) || 0.70
    };
  }

  async saveFeedbackSettings(userId: string, settings: FeedbackSettings): Promise<void> {
    await this.initializeSchema();
    const query = `
      INSERT INTO feedback_settings (user_id, is_enabled, max_examples, similarity_threshold, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        is_enabled = EXCLUDED.is_enabled,
        max_examples = EXCLUDED.max_examples,
        similarity_threshold = EXCLUDED.similarity_threshold,
        updated_at = CURRENT_TIMESTAMP;
    `;
    await this.getPool().query(query, [userId, settings.isEnabled, settings.maxExamples, settings.similarityThreshold || 0.70]);
  }

  async upsertCorrectionExample(example: CorrectionExample): Promise<void> {
    await this.initializeSchema();
    const id = example.id || crypto.randomUUID();
    const query = `
      INSERT INTO correction_examples (
        id, user_id, bronze_input_id, field_name, llm_value,
        corrected_value, email_snippet, embedding, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, bronze_input_id, field_name) DO UPDATE SET
        llm_value = EXCLUDED.llm_value,
        corrected_value = EXCLUDED.corrected_value,
        email_snippet = EXCLUDED.email_snippet,
        embedding = EXCLUDED.embedding,
        created_at = CURRENT_TIMESTAMP;
    `;
    await this.getPool().query(query, [
      id,
      example.userId,
      example.bronzeInputId,
      example.fieldName,
      example.llmValue || null,
      example.correctedValue,
      example.emailSnippet || null,
      example.embedding ? JSON.stringify(example.embedding) : null
    ]);
  }

  async getRecentCorrectionExamples(userId: string, limit: number): Promise<CorrectionExample[]> {
    await this.initializeSchema();
    const query = `
      SELECT id, user_id AS "userId", bronze_input_id AS "bronzeInputId",
             field_name AS "fieldName", llm_value AS "llmValue",
             corrected_value AS "correctedValue", email_snippet AS "emailSnippet",
             created_at AS "createdAt"
      FROM correction_examples
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await this.getPool().query(query, [userId, limit]);
    return result.rows.map(row => ({
      ...row,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : ''
    }));
  }

  async listCorrectionExamples(userId: string): Promise<CorrectionExample[]> {
    await this.initializeSchema();
    const query = `
      SELECT id, user_id AS "userId", bronze_input_id AS "bronzeInputId",
             field_name AS "fieldName", llm_value AS "llmValue",
             corrected_value AS "correctedValue", email_snippet AS "emailSnippet",
             created_at AS "createdAt"
      FROM correction_examples
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    const result = await this.getPool().query(query, [userId]);
    return result.rows.map(row => ({
      ...row,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : ''
    }));
  }

  async deleteCorrectionExample(id: string, userId: string): Promise<void> {
    await this.initializeSchema();
    const query = 'DELETE FROM correction_examples WHERE id = $1 AND user_id = $2';
    await this.getPool().query(query, [id, userId]);
  }

  async clearAllCorrectionExamples(userId: string): Promise<void> {
    await this.initializeSchema();
    const query = 'DELETE FROM correction_examples WHERE user_id = $1';
    await this.getPool().query(query, [userId]);
  }

  async getFeedbackEffectiveness(userId: string): Promise<FeedbackEffectiveness> {
    await this.initializeSchema();
    // 1. Weekly accuracy trend
    const weeklyQuery = `
      SELECT 
        TO_CHAR(g.transaction_date, 'IYYY-"W"IW') AS week,
        COUNT(*) AS total_records,
        COUNT(CASE WHEN s.merchant_normalized = g.merchant THEN 1 END) AS merchant_correct,
        COUNT(CASE WHEN s.inferred_category = g.category THEN 1 END) AS category_correct,
        COUNT(CASE WHEN s.payment_method = g.payment_method THEN 1 END) AS payment_correct
      FROM gold_transactions g
      JOIN silver_extracted_transactions s ON g.pending_tx_id = s.id AND g.user_id = s.user_id
      WHERE g.user_id = $1 AND g.deleted_at IS NULL
      GROUP BY TO_CHAR(g.transaction_date, 'IYYY-"W"IW')
      ORDER BY week ASC
    `;
    const weeklyResult = await this.getPool().query(weeklyQuery, [userId]);
    const weeklyTrend: WeeklyAccuracyEntry[] = weeklyResult.rows.map(row => {
      const total = parseInt(row.total_records, 10) || 1;
      return {
        week: row.week,
        merchantAccuracy: Math.round((parseInt(row.merchant_correct, 10) / total) * 100),
        categoryAccuracy: Math.round((parseInt(row.category_correct, 10) / total) * 100),
        paymentMethodAccuracy: Math.round((parseInt(row.payment_correct, 10) / total) * 100),
        totalRecords: total
      };
    });

    // 2. Oldest correction date for before/after comparison
    const oldestCorrQuery = 'SELECT MIN(created_at) AS oldest FROM correction_examples WHERE user_id = $1';
    const oldestResult = await this.getPool().query(oldestCorrQuery, [userId]);
    const cutoffDate = oldestResult.rows[0]?.oldest ? new Date(oldestResult.rows[0].oldest).toISOString() : null;

    let beforeSnapshot: FieldAccuracySnapshot | null = null;
    let afterSnapshot: FieldAccuracySnapshot | null = null;

    if (cutoffDate) {
      const beforeQuery = `
        SELECT 
          COUNT(*) AS total,
          COUNT(CASE WHEN s.merchant_normalized = g.merchant THEN 1 END) AS merchant_correct,
          COUNT(CASE WHEN s.inferred_category = g.category THEN 1 END) AS category_correct,
          COUNT(CASE WHEN s.payment_method = g.payment_method THEN 1 END) AS payment_correct
        FROM gold_transactions g
        JOIN silver_extracted_transactions s ON g.pending_tx_id = s.id AND g.user_id = s.user_id
        WHERE g.user_id = $1 AND g.created_at < $2 AND g.deleted_at IS NULL
      `;
      const beforeRes = await this.getPool().query(beforeQuery, [userId, cutoffDate]);
      const beforeTotal = parseInt(beforeRes.rows[0]?.total, 10) || 0;
      if (beforeTotal > 0) {
        beforeSnapshot = {
          merchantAccuracy: Math.round((parseInt(beforeRes.rows[0].merchant_correct, 10) / beforeTotal) * 100),
          categoryAccuracy: Math.round((parseInt(beforeRes.rows[0].category_correct, 10) / beforeTotal) * 100),
          paymentMethodAccuracy: Math.round((parseInt(beforeRes.rows[0].payment_correct, 10) / beforeTotal) * 100),
          totalRecords: beforeTotal
        };
      }

      const afterQuery = `
        SELECT 
          COUNT(*) AS total,
          COUNT(CASE WHEN s.merchant_normalized = g.merchant THEN 1 END) AS merchant_correct,
          COUNT(CASE WHEN s.inferred_category = g.category THEN 1 END) AS category_correct,
          COUNT(CASE WHEN s.payment_method = g.payment_method THEN 1 END) AS payment_correct
        FROM gold_transactions g
        JOIN silver_extracted_transactions s ON g.pending_tx_id = s.id AND g.user_id = s.user_id
        WHERE g.user_id = $1 AND g.created_at >= $2 AND g.deleted_at IS NULL
      `;
      const afterRes = await this.getPool().query(afterQuery, [userId, cutoffDate]);
      const afterTotal = parseInt(afterRes.rows[0]?.total, 10) || 0;
      if (afterTotal > 0) {
        afterSnapshot = {
          merchantAccuracy: Math.round((parseInt(afterRes.rows[0].merchant_correct, 10) / afterTotal) * 100),
          categoryAccuracy: Math.round((parseInt(afterRes.rows[0].category_correct, 10) / afterTotal) * 100),
          paymentMethodAccuracy: Math.round((parseInt(afterRes.rows[0].payment_correct, 10) / afterTotal) * 100),
          totalRecords: afterTotal
        };
      }
    }

    // 3. Coverage by field
    const countQuery = `
      SELECT field_name, COUNT(*) AS count
      FROM correction_examples
      WHERE user_id = $1
      GROUP BY field_name
    `;
    const countRes = await this.getPool().query(countQuery, [userId]);
    const byField: Record<string, number> = {};
    let totalExamples = 0;
    for (const r of countRes.rows) {
      const c = parseInt(r.count, 10) || 0;
      byField[r.field_name] = c;
      totalExamples += c;
    }

    return {
      weeklyTrend,
      beforeAfter: {
        cutoffDate,
        before: beforeSnapshot,
        after: afterSnapshot
      },
      coverage: {
        totalExamples,
        byField,
        historicalMissesByField: byField
      }
    };
  }
}
