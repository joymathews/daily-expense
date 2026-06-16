/**
 * Standalone migration script: upgrades transaction_type CHECK constraints
 * in silver_extracted_transactions, gold_transactions, and llm_extraction_logs
 * to add 'transfer' support. All existing data is preserved.
 *
 * Run: node tools/migrate-transfer-constraint.js
 */
const sqlite3 = require(require('path').join(__dirname, '../backend/node_modules/sqlite3')).verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../backend/data/daily_expense.db');

const db = new sqlite3.Database(DB_PATH);

function run(sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql) {
  return new Promise((resolve, reject) => {
    db.get(sql, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function migrate() {
  // Disable foreign keys for the migration to allow table drops
  await run('PRAGMA foreign_keys = OFF;');

  const silverDdl = await get("SELECT sql FROM sqlite_master WHERE type='table' AND name='silver_extracted_transactions';");
  if (!silverDdl || !silverDdl.sql) {
    console.log('Silver table does not exist yet. Nothing to migrate.');
    return;
  }

  const needsMigration = silverDdl.sql.includes("'expense', 'refund')") && !silverDdl.sql.includes("'transfer'");
  if (!needsMigration) {
    console.log('✅ Migration already applied. Constraints are up to date.');
    return;
  }

  // Count rows before migration
  const [silverBefore, goldBefore, llmBefore] = await Promise.all([
    get('SELECT COUNT(*) as cnt FROM silver_extracted_transactions'),
    get('SELECT COUNT(*) as cnt FROM gold_transactions'),
    get('SELECT COUNT(*) as cnt FROM llm_extraction_logs'),
  ]);
  console.log(`Before migration: silver=${silverBefore.cnt}, gold=${goldBefore.cnt}, llm_logs=${llmBefore.cnt}`);

  await run('BEGIN TRANSACTION');
  try {
    // --- Silver ---
    console.log('Migrating silver_extracted_transactions...');
    await run(`CREATE TABLE silver_extracted_transactions_new (
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
      transaction_type TEXT DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund', 'transfer')),
      parent_transaction_id TEXT,
      deleted_at TEXT,
      extracted_at TEXT DEFAULT (datetime('now', 'utc')),
      UNIQUE(user_id, bronze_input_id),
      UNIQUE(user_id, id)
    );`);
    await run(`INSERT INTO silver_extracted_transactions_new
      SELECT id, user_id, bronze_input_id, source_type, merchant_raw, merchant_normalized,
             amount_cents, currency, transaction_date, inferred_category, confidence_score,
             status, payment_method, transaction_type, parent_transaction_id, deleted_at, extracted_at
      FROM silver_extracted_transactions;`);
    await run('DROP TABLE silver_extracted_transactions;');
    await run('ALTER TABLE silver_extracted_transactions_new RENAME TO silver_extracted_transactions;');

    // --- Gold ---
    console.log('Migrating gold_transactions...');
    await run(`CREATE TABLE gold_transactions_new (
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
      transaction_type TEXT DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund', 'transfer')),
      parent_transaction_id TEXT,
      deleted_at TEXT,
      created_at TEXT DEFAULT (datetime('now', 'utc')),
      updated_at TEXT DEFAULT (datetime('now', 'utc')),
      UNIQUE(user_id, id)
    );`);
    await run(`INSERT INTO gold_transactions_new
      SELECT id, silver_tx_id, user_id, source_type, merchant, amount_cents, currency,
             transaction_date, category, notes, payment_method, transaction_type,
             parent_transaction_id, deleted_at, created_at, updated_at
      FROM gold_transactions;`);
    await run('DROP TABLE gold_transactions;');
    await run('ALTER TABLE gold_transactions_new RENAME TO gold_transactions;');

    // --- LLM Extraction Logs ---
    const llmDdl = await get("SELECT sql FROM sqlite_master WHERE type='table' AND name='llm_extraction_logs';");
    if (llmDdl && llmDdl.sql && llmDdl.sql.includes("'expense', 'refund')") && !llmDdl.sql.includes("'transfer'")) {
      console.log('Migrating llm_extraction_logs...');
      await run(`CREATE TABLE llm_extraction_logs_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        bronze_input_id TEXT NOT NULL UNIQUE,
        extracted_merchant TEXT,
        extracted_amount_cents INTEGER,
        extracted_currency TEXT,
        extracted_date TEXT,
        extracted_category TEXT,
        extracted_payment_method TEXT,
        extracted_transaction_type TEXT DEFAULT 'expense' CHECK (extracted_transaction_type IN ('expense', 'refund', 'transfer')),
        confidence_score REAL,
        extracted_at TEXT DEFAULT (datetime('now', 'utc')),
        UNIQUE(user_id, bronze_input_id),
        UNIQUE(user_id, id)
      );`);
      await run(`INSERT INTO llm_extraction_logs_new
        SELECT id, user_id, bronze_input_id, extracted_merchant, extracted_amount_cents,
               extracted_currency, extracted_date, extracted_category, extracted_payment_method,
               extracted_transaction_type, confidence_score, extracted_at
        FROM llm_extraction_logs;`);
      await run('DROP TABLE llm_extraction_logs;');
      await run('ALTER TABLE llm_extraction_logs_new RENAME TO llm_extraction_logs;');
    }

    await run('COMMIT');

    // Count rows after migration
    const [silverAfter, goldAfter, llmAfter] = await Promise.all([
      get('SELECT COUNT(*) as cnt FROM silver_extracted_transactions'),
      get('SELECT COUNT(*) as cnt FROM gold_transactions'),
      get('SELECT COUNT(*) as cnt FROM llm_extraction_logs'),
    ]);
    console.log(`After migration:  silver=${silverAfter.cnt}, gold=${goldAfter.cnt}, llm_logs=${llmAfter.cnt}`);

    if (silverBefore.cnt === silverAfter.cnt && goldBefore.cnt === goldAfter.cnt) {
      console.log('✅ Migration complete. All data preserved. No rows lost.');
    } else {
      console.error('⚠️  Row count mismatch! Manual inspection required.');
    }
  } catch (err) {
    await run('ROLLBACK');
    console.error('❌ Migration FAILED and was rolled back:', err.message);
    throw err;
  } finally {
    await run('PRAGMA foreign_keys = ON;');
    db.close();
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
