import sqlite3 from 'sqlite3';
import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment configuration from .env inside migration-tool folder
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const sqliteDbPath = process.env.SQLITE_DB_PATH || '../backend/data/daily_expense.db';
const resolvedSqlitePath = path.isAbsolute(sqliteDbPath)
  ? sqliteDbPath
  : path.resolve(__dirname, '..', sqliteDbPath);

const azureConfig: sql.config = {
  server: process.env.AZURE_SQL_SERVER || '',
  database: process.env.AZURE_SQL_DATABASE || '',
  user: process.env.AZURE_SQL_USER || '',
  password: process.env.AZURE_SQL_PASSWORD || '',
  port: parseInt(process.env.AZURE_SQL_PORT || '1433', 10),
  options: {
    encrypt: process.env.AZURE_SQL_ENCRYPT !== 'false',
    trustServerCertificate: process.env.AZURE_SQL_TRUST_SERVER_CERTIFICATE === 'true',
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

export interface VerificationResult {
  table: string;
  sqliteCount: number;
  azureSqlCount: number;
  match: boolean;
}

export interface FinancialAuditResult {
  sqliteGoldSum: number;
  azureSqlGoldSum: number;
  difference: number;
  match: boolean;
}

/** Promisified helper to execute SQLite SELECT queries */
export function querySqlite<T>(db: sqlite3.Database, query: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows as T[]);
    });
  });
}

/** Execute T-SQL DDL Schema Script against Azure SQL */
export async function executeAzureSchema(pool: sql.ConnectionPool): Promise<void> {
  const schemaPath = path.resolve(__dirname, 'azure-sql-schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found at: ${schemaPath}`);
  }
  const ddlScript = fs.readFileSync(schemaPath, 'utf8');

  // Split on GO or execute batches
  const batches = ddlScript.split(/\nGO\b/i).filter(b => b.trim().length > 0);
  for (const batch of batches) {
    await pool.request().query(batch);
  }
}

/** Main Migration and Verification Engine */
export async function runMigrationAndVerification(): Promise<{
  verificationResults: VerificationResult[];
  financialAudit: FinancialAuditResult;
}> {
  console.log('=============================================================================');
  console.log('    DAILY EXPENSE: SQLITE TO AZURE SQL MIGRATION & VERIFICATION TOOL        ');
  console.log('=============================================================================\n');

  if (!fs.existsSync(resolvedSqlitePath)) {
    throw new Error(`SQLite database file not found at path: ${resolvedSqlitePath}`);
  }

  console.log(`[1/5] Opening SQLite Database in READ-ONLY mode: ${resolvedSqlitePath}`);
  const sqliteDb = new sqlite3.Database(resolvedSqlitePath, sqlite3.OPEN_READONLY);

  console.log(`[2/5] Connecting to Azure SQL Database: ${azureConfig.server} / ${azureConfig.database}`);
  const pool = await sql.connect(azureConfig);

  console.log('[3/5] Executing Azure SQL DDL Schema Script...');
  await executeAzureSchema(pool);

  console.log('[4/5] Migrating Data from SQLite to Azure SQL...');

  // Order tables to honor Foreign Key constraints
  const tablesInOrder = [
    'user_preferences',
    'fetcher_emails',
    'payment_methods',
    'payment_mapping_rules',
    'fixed_charges',
    'bronze_raw_inputs',
    'silver_extracted_transactions',
    'gold_transactions',
    'user_cycles',
    'llm_extraction_logs',
    'llm_feedback_settings',
    'llm_correction_examples',
  ];

  for (const table of tablesInOrder) {
    await migrateTableData(sqliteDb, pool, table);
  }

  console.log('\n[5/5] Running Automated Verification & Audit Suite...');
  const verificationResults: VerificationResult[] = [];

  for (const table of tablesInOrder) {
    const sqliteRows = await querySqlite<{ count: number }>(sqliteDb, `SELECT COUNT(*) as count FROM ${table}`);
    const sqliteCount = sqliteRows[0]?.count || 0;

    const azureResult = await pool.request().query(`SELECT COUNT(*) as count FROM ${table}`);
    const azureSqlCount = azureResult.recordset[0]?.count || 0;

    verificationResults.push({
      table,
      sqliteCount,
      azureSqlCount,
      match: sqliteCount === azureSqlCount,
    });
  }

  // Financial Sum Audit for Gold Transactions
  const sqliteSumRes = await querySqlite<{ sumAmount: number }>(
    sqliteDb,
    `SELECT COALESCE(SUM(amount_cents), 0) / 100.0 as sumAmount FROM gold_transactions WHERE deleted_at IS NULL`
  );
  const sqliteGoldSum = Number(sqliteSumRes[0]?.sumAmount || 0);

  const azureSumRes = await pool.request().query(
    `SELECT COALESCE(SUM(amount), 0) as sumAmount FROM gold_transactions WHERE deleted_at IS NULL`
  );
  const azureSqlGoldSum = Number(azureSumRes.recordset[0]?.sumAmount || 0);
  const difference = Math.abs(sqliteGoldSum - azureSqlGoldSum);
  const financialAudit: FinancialAuditResult = {
    sqliteGoldSum,
    azureSqlGoldSum,
    difference,
    match: difference < 0.01,
  };

  // Close connections
  sqliteDb.close();
  await pool.close();

  printVerificationReport(verificationResults, financialAudit);

  return { verificationResults, financialAudit };
}

/** Table-specific migration handler */
async function migrateTableData(sqliteDb: sqlite3.Database, pool: sql.ConnectionPool, table: string): Promise<void> {
  const rows = await querySqlite<any>(sqliteDb, `SELECT * FROM ${table}`);
  if (rows.length === 0) {
    console.log(`  - Table [${table}]: 0 rows found in SQLite. Skipped.`);
    return;
  }

  console.log(`  - Migrating [${table}]: ${rows.length} rows...`);

  for (const row of rows) {
    switch (table) {
      case 'user_preferences':
        await pool
          .request()
          .input('user_id', sql.NVarChar(255), row.user_id)
          .input('defaults_seeded', sql.Bit, row.defaults_seeded ? 1 : 0)
          .input('billing_cycle_start_day', sql.Int, row.billing_cycle_start_day ?? 17)
          .input('expected_salary', sql.Decimal(18, 2), row.expected_salary ?? 100000.0)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM user_preferences WHERE user_id = @user_id)
            INSERT INTO user_preferences (user_id, defaults_seeded, billing_cycle_start_day, expected_salary)
            VALUES (@user_id, @defaults_seeded, @billing_cycle_start_day, @expected_salary)
          `);
        break;

      case 'fetcher_emails':
        await pool
          .request()
          .input('user_id', sql.NVarChar(255), row.user_id)
          .input('email', sql.NVarChar(255), row.email)
          .input('created_at', sql.NVarChar(50), row.created_at)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM fetcher_emails WHERE user_id = @user_id AND email = @email)
            INSERT INTO fetcher_emails (user_id, email, created_at)
            VALUES (@user_id, @email, COALESCE(@created_at, SYSUTCDATETIME()))
          `);
        break;

      case 'payment_methods':
        await pool
          .request()
          .input('id', sql.NVarChar(255), row.id)
          .input('user_id', sql.NVarChar(255), row.user_id)
          .input('name', sql.NVarChar(100), row.name)
          .input('created_at', sql.NVarChar(50), row.created_at)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM payment_methods WHERE id = @id)
            INSERT INTO payment_methods (id, user_id, name, created_at)
            VALUES (@id, @user_id, @name, COALESCE(@created_at, SYSUTCDATETIME()))
          `);
        break;

      case 'payment_mapping_rules':
        await pool
          .request()
          .input('id', sql.NVarChar(255), row.id)
          .input('user_id', sql.NVarChar(255), row.user_id)
          .input('alias_pattern', sql.NVarChar(255), row.alias_pattern)
          .input('payment_method_id', sql.NVarChar(255), row.payment_method_id)
          .input('created_at', sql.NVarChar(50), row.created_at)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM payment_mapping_rules WHERE id = @id)
            INSERT INTO payment_mapping_rules (id, user_id, alias_pattern, payment_method_id, created_at)
            VALUES (@id, @user_id, @alias_pattern, @payment_method_id, COALESCE(@created_at, SYSUTCDATETIME()))
          `);
        break;

      case 'fixed_charges':
        await pool
          .request()
          .input('id', sql.NVarChar(255), row.id)
          .input('user_id', sql.NVarChar(255), row.user_id)
          .input('name', sql.NVarChar(255), row.name)
          .input('amount', sql.Decimal(18, 2), row.amount)
          .input('currency', sql.NVarChar(10), row.currency || 'INR')
          .input('category', sql.NVarChar(100), row.category)
          .input('start_date', sql.NVarChar(50), row.start_date)
          .input('end_date', sql.NVarChar(50), row.end_date)
          .input('payment_method', sql.NVarChar(100), row.payment_method || null)
          .input('created_at', sql.NVarChar(50), row.created_at)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM fixed_charges WHERE id = @id)
            INSERT INTO fixed_charges (id, user_id, name, amount, currency, category, start_date, end_date, payment_method, created_at)
            VALUES (@id, @user_id, @name, @amount, @currency, @category, @start_date, @end_date, @payment_method, COALESCE(@created_at, SYSUTCDATETIME()))
          `);
        break;

      case 'bronze_raw_inputs':
        await pool
          .request()
          .input('id', sql.NVarChar(255), row.id)
          .input('user_id', sql.NVarChar(255), row.user_id)
          .input('source_type', sql.NVarChar(50), row.source_type || 'email')
          .input('sender', sql.NVarChar(255), row.sender)
          .input('title', sql.NVarChar(500), row.title)
          .input('snippet', sql.NVarChar(sql.MAX), row.snippet || null)
          .input('raw_body', sql.NVarChar(sql.MAX), row.raw_body)
          .input('raw_payload', sql.NVarChar(sql.MAX), row.raw_payload || null)
          .input('received_at', sql.NVarChar(50), row.received_at)
          .input('has_transaction', sql.Bit, row.has_transaction ? 1 : 0)
          .input('status', sql.NVarChar(50), row.status || 'unprocessed')
          .input('deleted_at', sql.NVarChar(50), row.deleted_at || null)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM bronze_raw_inputs WHERE user_id = @user_id AND id = @id)
            INSERT INTO bronze_raw_inputs (id, user_id, source_type, sender, title, snippet, raw_body, raw_payload, received_at, has_transaction, status, deleted_at)
            VALUES (@id, @user_id, @source_type, @sender, @title, @snippet, @raw_body, @raw_payload, @received_at, @has_transaction, @status, @deleted_at)
          `);
        break;

      case 'silver_extracted_transactions':
        const silverAmount = Number(row.amount_cents) / 100.0;
        await pool
          .request()
          .input('id', sql.NVarChar(255), row.id)
          .input('user_id', sql.NVarChar(255), row.user_id)
          .input('bronze_input_id', sql.NVarChar(255), row.bronze_input_id)
          .input('source_type', sql.NVarChar(50), row.source_type || 'email')
          .input('merchant_raw', sql.NVarChar(255), row.merchant_raw)
          .input('merchant_normalized', sql.NVarChar(255), row.merchant_normalized || null)
          .input('amount_cents', sql.BigInt, row.amount_cents)
          .input('amount', sql.Decimal(18, 2), silverAmount)
          .input('currency', sql.NVarChar(10), row.currency)
          .input('transaction_date', sql.NVarChar(50), row.transaction_date)
          .input('inferred_category', sql.NVarChar(100), row.inferred_category || null)
          .input('confidence_score', sql.Float, row.confidence_score || null)
          .input('status', sql.NVarChar(50), row.status || 'pending')
          .input('payment_method', sql.NVarChar(100), row.payment_method || null)
          .input('transaction_type', sql.NVarChar(50), row.transaction_type || 'expense')
          .input('parent_transaction_id', sql.NVarChar(255), row.parent_transaction_id || null)
          .input('deleted_at', sql.NVarChar(50), row.deleted_at || null)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM silver_extracted_transactions WHERE id = @id)
            INSERT INTO silver_extracted_transactions (id, user_id, bronze_input_id, source_type, merchant_raw, merchant_normalized, amount_cents, amount, currency, transaction_date, inferred_category, confidence_score, status, payment_method, transaction_type, parent_transaction_id, deleted_at)
            VALUES (@id, @user_id, @bronze_input_id, @source_type, @merchant_raw, @merchant_normalized, @amount_cents, @amount, @currency, @transaction_date, @inferred_category, @confidence_score, @status, @payment_method, @transaction_type, @parent_transaction_id, @deleted_at)
          `);
        break;

      case 'gold_transactions':
        const goldAmount = Number(row.amount_cents) / 100.0;
        await pool
          .request()
          .input('id', sql.NVarChar(255), row.id)
          .input('silver_tx_id', sql.NVarChar(255), row.silver_tx_id || null)
          .input('user_id', sql.NVarChar(255), row.user_id)
          .input('source_type', sql.NVarChar(50), row.source_type || 'email')
          .input('merchant', sql.NVarChar(255), row.merchant)
          .input('amount_cents', sql.BigInt, row.amount_cents)
          .input('amount', sql.Decimal(18, 2), goldAmount)
          .input('currency', sql.NVarChar(10), row.currency)
          .input('transaction_date', sql.NVarChar(50), row.transaction_date)
          .input('category', sql.NVarChar(100), row.category)
          .input('notes', sql.NVarChar(sql.MAX), row.notes || null)
          .input('payment_method', sql.NVarChar(100), row.payment_method || null)
          .input('transaction_type', sql.NVarChar(50), row.transaction_type || 'expense')
          .input('parent_transaction_id', sql.NVarChar(255), row.parent_transaction_id || null)
          .input('source_received_at', sql.NVarChar(50), row.source_received_at || null)
          .input('deleted_at', sql.NVarChar(50), row.deleted_at || null)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM gold_transactions WHERE id = @id)
            INSERT INTO gold_transactions (id, silver_tx_id, user_id, source_type, merchant, amount_cents, amount, currency, transaction_date, category, notes, payment_method, transaction_type, parent_transaction_id, source_received_at, deleted_at)
            VALUES (@id, @silver_tx_id, @user_id, @source_type, @merchant, @amount_cents, @amount, @currency, @transaction_date, @category, @notes, @payment_method, @transaction_type, @parent_transaction_id, @source_received_at, @deleted_at)
          `);
        break;

      case 'user_cycles':
        await pool
          .request()
          .input('id', sql.NVarChar(255), row.id)
          .input('user_id', sql.NVarChar(255), row.user_id)
          .input('cycle_name', sql.NVarChar(100), row.cycle_name || null)
          .input('start_type', sql.NVarChar(50), row.start_type)
          .input('start_transaction_id', sql.NVarChar(255), row.start_transaction_id || null)
          .input('start_date', sql.NVarChar(50), row.start_date)
          .input('start_timestamp', sql.NVarChar(50), row.start_timestamp)
          .input('end_date', sql.NVarChar(50), row.end_date || null)
          .input('end_timestamp', sql.NVarChar(50), row.end_timestamp || null)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM user_cycles WHERE id = @id)
            INSERT INTO user_cycles (id, user_id, cycle_name, start_type, start_transaction_id, start_date, start_timestamp, end_date, end_timestamp)
            VALUES (@id, @user_id, @cycle_name, @start_type, @start_transaction_id, @start_date, @start_timestamp, @end_date, @end_timestamp)
          `);
        break;

      case 'llm_extraction_logs':
        await pool
          .request()
          .input('id', sql.NVarChar(255), row.id)
          .input('user_id', sql.NVarChar(255), row.user_id)
          .input('bronze_input_id', sql.NVarChar(255), row.bronze_input_id)
          .input('extracted_merchant', sql.NVarChar(255), row.extracted_merchant || null)
          .input('extracted_amount_cents', sql.BigInt, row.extracted_amount_cents || null)
          .input('extracted_currency', sql.NVarChar(10), row.extracted_currency || null)
          .input('extracted_date', sql.NVarChar(50), row.extracted_date || null)
          .input('extracted_category', sql.NVarChar(100), row.extracted_category || null)
          .input('extracted_payment_method', sql.NVarChar(100), row.extracted_payment_method || null)
          .input('extracted_transaction_type', sql.NVarChar(50), row.extracted_transaction_type || 'expense')
          .input('confidence_score', sql.Float, row.confidence_score || null)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM llm_extraction_logs WHERE id = @id)
            INSERT INTO llm_extraction_logs (id, user_id, bronze_input_id, extracted_merchant, extracted_amount_cents, extracted_currency, extracted_date, extracted_category, extracted_payment_method, extracted_transaction_type, confidence_score)
            VALUES (@id, @user_id, @bronze_input_id, @extracted_merchant, @extracted_amount_cents, @extracted_currency, @extracted_date, @extracted_category, @extracted_payment_method, @extracted_transaction_type, @confidence_score)
          `);
        break;

      case 'llm_feedback_settings':
        await pool
          .request()
          .input('user_id', sql.NVarChar(255), row.user_id)
          .input('is_enabled', sql.Bit, row.is_enabled ? 1 : 0)
          .input('max_examples', sql.Int, row.max_examples ?? 10)
          .input('similarity_threshold', sql.Float, row.similarity_threshold ?? 0.3)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM llm_feedback_settings WHERE user_id = @user_id)
            INSERT INTO llm_feedback_settings (user_id, is_enabled, max_examples, similarity_threshold)
            VALUES (@user_id, @is_enabled, @max_examples, @similarity_threshold)
          `);
        break;

      case 'llm_correction_examples':
        await pool
          .request()
          .input('id', sql.NVarChar(255), row.id)
          .input('user_id', sql.NVarChar(255), row.user_id)
          .input('bronze_input_id', sql.NVarChar(255), row.bronze_input_id)
          .input('field_name', sql.NVarChar(50), row.field_name)
          .input('llm_value', sql.NVarChar(sql.MAX), row.llm_value || null)
          .input('corrected_value', sql.NVarChar(sql.MAX), row.corrected_value)
          .input('email_snippet', sql.NVarChar(sql.MAX), row.email_snippet || null)
          .input('embedding', sql.NVarChar(sql.MAX), row.embedding || null)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM llm_correction_examples WHERE id = @id)
            INSERT INTO llm_correction_examples (id, user_id, bronze_input_id, field_name, llm_value, corrected_value, email_snippet, embedding)
            VALUES (@id, @user_id, @bronze_input_id, @field_name, @llm_value, @corrected_value, @email_snippet, @embedding)
          `);
        break;
    }
  }
}

/** Print terminal verification audit report */
function printVerificationReport(
  results: VerificationResult[],
  financialAudit: FinancialAuditResult
): void {
  console.log('\n=============================================================================');
  console.log('                   AUTOMATED VERIFICATION AUDIT REPORT                       ');
  console.log('=============================================================================');
  console.log('TABLE NAME                     | SQLITE COUNT | AZURE SQL COUNT | STATUS');
  console.log('-----------------------------------------------------------------------------');

  let allTablesMatch = true;
  for (const r of results) {
    const status = r.match ? '✅ MATCH' : '❌ MISMATCH';
    if (!r.match) allTablesMatch = false;
    const tableNamePadded = r.table.padEnd(30, ' ');
    const sqliteCountPadded = String(r.sqliteCount).padStart(12, ' ');
    const azureCountPadded = String(r.azureSqlCount).padStart(17, ' ');
    console.log(`${tableNamePadded} | ${sqliteCountPadded} | ${azureCountPadded} | ${status}`);
  }

  console.log('-----------------------------------------------------------------------------');
  console.log('\n--- FINANCIAL SUM AUDIT (Gold Ledger Active Transactions) ---');
  console.log(`SQLite Gold Total Amount:    $${financialAudit.sqliteGoldSum.toFixed(2)}`);
  console.log(`Azure SQL Gold Total Amount: $${financialAudit.azureSqlGoldSum.toFixed(2)}`);
  console.log(`Difference:                 $${financialAudit.difference.toFixed(2)}`);
  console.log(`Financial Audit Status:     ${financialAudit.match ? '✅ MATCH (0.00 Difference)' : '❌ MISMATCH'}`);
  console.log('=============================================================================\n');

  if (allTablesMatch && financialAudit.match) {
    console.log('🎉 SUCCESS: All 12 tables and financial metrics migrated with 100% data fidelity!');
  } else {
    console.warn('⚠️ WARNING: Mismatches were detected during verification. Please review audit details.');
  }
}

// Allow direct execution from CLI
if (require.main === module) {
  runMigrationAndVerification().catch(err => {
    console.error('Fatal error during migration:', err);
    process.exit(1);
  });
}
