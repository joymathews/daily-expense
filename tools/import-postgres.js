const path = require('path');
const fs = require('fs');

// Strict topological foreign-key dependency order for insertion
const IMPORT_ORDER_TABLES = [
  'bronze_raw_inputs',
  'silver_extracted_transactions',
  'gold_transactions',
  'payment_methods',
  'payment_mapping_rules',
  'fetcher_emails',
  'user_preferences',
  'cycle_override',
  'fixed_charges',
  'llm_extraction_logs',
  'feedback_settings',
  'correction_examples',
];

function resolvePostgresEnvConfig() {
  let resolvedUser = process.env.POSTGRES_USER;
  let resolvedPassword = process.env.POSTGRES_PASSWORD;
  let resolvedDatabase = process.env.POSTGRES_DB;
  let resolvedHost = process.env.POSTGRES_HOST || 'localhost';
  let resolvedPort = parseInt(process.env.POSTGRES_PORT || '5432', 10);

  const envFiles = [
    path.resolve(__dirname, '../services/postgres/.env'),
    path.resolve(__dirname, '../backend/.env'),
    path.resolve(__dirname, '../.env'),
  ];

  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      if (!resolvedUser) {
        const match = content.match(/POSTGRES_USER\s*=\s*(.+)/);
        if (match) resolvedUser = match[1].trim().replace(/^['"]|['"]$/g, '');
      }
      if (!resolvedPassword) {
        const match = content.match(/POSTGRES_PASSWORD\s*=\s*(.+)/);
        if (match) resolvedPassword = match[1].trim().replace(/^['"]|['"]$/g, '');
      }
      if (!resolvedDatabase) {
        const match = content.match(/POSTGRES_DB\s*=\s*(.+)/);
        if (match) resolvedDatabase = match[1].trim().replace(/^['"]|['"]$/g, '');
      }
      if (!process.env.POSTGRES_HOST) {
        const match = content.match(/POSTGRES_HOST\s*=\s*(.+)/);
        if (match) resolvedHost = match[1].trim().replace(/^['"]|['"]$/g, '');
      }
      if (!process.env.POSTGRES_PORT) {
        const match = content.match(/POSTGRES_PORT\s*=\s*(.+)/);
        if (match) resolvedPort = parseInt(match[1].trim().replace(/^['"]|['"]$/g, ''), 10);
      }
    }
  }

  return {
    user: resolvedUser || 'postgres',
    password: resolvedPassword || 'postgres',
    database: resolvedDatabase || 'daily_expense_db',
    host: resolvedHost,
    port: resolvedPort,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

function getPgPool(customConfig) {
  let pg;
  try {
    pg = require('pg');
  } catch (e) {
    try {
      pg = require(path.resolve(__dirname, '../packages/db-postgres/node_modules/pg'));
    } catch (err) {
      try {
        pg = require(path.resolve(__dirname, '../backend/node_modules/pg'));
      } catch (finalErr) {
        throw new Error('pg module not found. Please run npm install.');
      }
    }
  }

  const config = customConfig || resolvePostgresEnvConfig();
  return new pg.Pool(config);
}

function normalizeDateValue(val, isDateOnly = false) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val !== 'string') return val;

  const trimmed = val.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') return null;

  // Match DD-MM-YY (e.g. 27-06-26)
  const ddmmyyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/);
  if (ddmmyyMatch) {
    const day = ddmmyyMatch[1].padStart(2, '0');
    const month = ddmmyyMatch[2].padStart(2, '0');
    const year = `20${ddmmyyMatch[3]}`;
    return `${year}-${month}-${day}`;
  }

  // Match DD-MM-YYYY (e.g. 27-06-2026)
  const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (ddmmyyyyMatch) {
    const day = ddmmyyyyMatch[1].padStart(2, '0');
    const month = ddmmyyyyMatch[2].padStart(2, '0');
    const year = ddmmyyyyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // If DATE column and given ISO string (e.g. 2026-06-28T09:31:36.000Z), extract YYYY-MM-DD
  if (isDateOnly && trimmed.includes('T')) {
    return trimmed.split('T')[0];
  }

  return trimmed;
}

const DATE_ONLY_COLUMNS = ['transaction_date', 'start_date', 'end_date'];
const TIMESTAMP_COLUMNS = [
  'received_at',
  'ingested_at',
  'extracted_at',
  'source_received_at',
  'created_at',
  'updated_at',
  'deleted_at',
  'start_timestamp',
  'end_timestamp',
];

/**
 * Builds conflict-safe INSERT statement dynamically per table and row against valid target columns.
 */
function buildInsertQuery(tableName, row, validColumns) {
  // Normalize column aliases
  const preparedRow = { ...row };
  if (preparedRow.silver_tx_id !== undefined && !preparedRow.pending_tx_id) {
    preparedRow.pending_tx_id = preparedRow.silver_tx_id;
  }

  // Ensure amount_cents is present if amount was provided
  if (preparedRow.amount_cents === undefined && preparedRow.amount !== undefined) {
    preparedRow.amount_cents = Math.round(Number(preparedRow.amount) * 100);
  }

  // Filter keys strictly to valid columns present in the target database schema
  const columns = Object.keys(preparedRow).filter(c => {
    if (!validColumns || validColumns.length === 0) return true;
    return validColumns.includes(c);
  });

  if (columns.length === 0) return null;

  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const columnNames = columns.map(c => `"${c}"`).join(', ');

  let conflictClause = 'ON CONFLICT DO NOTHING';

  if (tableName === 'user_preferences') {
    const updateClauses = columns
      .filter(c => c !== 'user_id')
      .map(c => `"${c}" = EXCLUDED."${c}"`)
      .join(', ');
    if (updateClauses) {
      conflictClause = `ON CONFLICT ("user_id") DO UPDATE SET ${updateClauses}`;
    }
  } else if (tableName === 'feedback_settings') {
    const updateClauses = columns
      .filter(c => c !== 'user_id')
      .map(c => `"${c}" = EXCLUDED."${c}"`)
      .join(', ');
    if (updateClauses) {
      conflictClause = `ON CONFLICT ("user_id") DO UPDATE SET ${updateClauses}`;
    }
  }

  const sql = `
    INSERT INTO "${tableName}" (${columnNames})
    VALUES (${placeholders})
    ${conflictClause}
  `;

  // Map JSON and date values if needed
  const values = columns.map(c => {
    let val = preparedRow[c];
    if (DATE_ONLY_COLUMNS.includes(c)) {
      val = normalizeDateValue(val, true);
    } else if (TIMESTAMP_COLUMNS.includes(c)) {
      val = normalizeDateValue(val, false);
    } else if (val !== null && typeof val === 'object') {
      return JSON.stringify(val);
    }
    return val;
  });

  return { sql, values };
}

/**
 * Core import execution function.
 * [FUNC-SYS-11, NFR-DB-7]
 */
async function importPostgresSnapshot(customConfig, customInputDir) {
  const inputDir = customInputDir || (process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : path.resolve(__dirname, '../data/exports/latest'));

  if (!fs.existsSync(inputDir)) {
    throw new Error(`Import snapshot directory does not exist: ${inputDir}. Please run "npm run db:export" first.`);
  }

  const manifestPath = path.join(inputDir, 'manifest.json');
  let manifest = { tables: {}, totalRows: 0 };
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      console.warn('⚠️ Could not parse manifest.json, proceeding with file inspection.');
    }
  }

  const pool = getPgPool(customConfig);
  const client = await pool.connect();

  const reconciliationReport = [];
  let totalImported = 0;

  console.log(`🔌 Connected to PostgreSQL (${pool.options.host}:${pool.options.port}/${pool.options.database})`);
  console.log(`📁 Ingesting snapshot from: ${inputDir}\n`);

  try {
    for (const tableName of IMPORT_ORDER_TABLES) {
      const tableFile = path.join(inputDir, `${tableName}.json`);
      let rows = [];

      if (fs.existsSync(tableFile)) {
        try {
          const content = fs.readFileSync(tableFile, 'utf8');
          rows = JSON.parse(content);
        } catch (readErr) {
          console.error(`⚠️ Error reading ${tableFile}: ${readErr.message}`);
        }
      }

      // Query valid columns for this table in PostgreSQL
      let validColumns = [];
      try {
        const colRes = await client.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
          [tableName]
        );
        validColumns = colRes.rows.map(r => r.column_name);
      } catch (colErr) {
        validColumns = [];
      }

      let insertedCount = 0;

      if (Array.isArray(rows) && rows.length > 0) {
        await client.query('BEGIN');
        try {
          for (const row of rows) {
            const queryData = buildInsertQuery(tableName, row, validColumns);
            if (queryData) {
              await client.query(queryData.sql, queryData.values);
              insertedCount++;
            }
          }
          await client.query('COMMIT');
        } catch (insertErr) {
          await client.query('ROLLBACK');
          throw new Error(`Failed inserting into ${tableName}: ${insertErr.message}`);
        }
      }

      totalImported += insertedCount;

      // Query current live count in Postgres
      let liveCount = 0;
      try {
        const countRes = await client.query(`SELECT COUNT(*)::int AS count FROM "${tableName}"`);
        liveCount = countRes.rows[0].count;
      } catch (countErr) {
        // Table may not exist if migrations haven't run
        liveCount = insertedCount;
      }

      const expectedCount = manifest.tables[tableName] !== undefined ? manifest.tables[tableName] : rows.length;
      const status = liveCount >= expectedCount ? 'MATCH' : 'PARTIAL';

      reconciliationReport.push({
        'Table Name': tableName,
        'Exported Count': expectedCount,
        'Inserted In Run': insertedCount,
        'Live PG Count': liveCount,
        'Status': status,
      });
    }

    return {
      totalImported,
      reconciliationReport,
      manifest,
      inputDir,
    };
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  (async () => {
    try {
      const result = await importPostgresSnapshot();
      console.log('\n========================================');
      console.log('   POSTGRESQL DATA IMPORT COMPLETED     ');
      console.log('========================================\n');
      console.table(result.reconciliationReport);
      console.log(`\n✔ Ingestion finished. Processed ${result.totalImported} records.\n`);
      process.exit(0);
    } catch (err) {
      console.error(`\n❌ Import Failed: ${err.message}`);
      process.exit(1);
    }
  })();
}

module.exports = {
  importPostgresSnapshot,
  IMPORT_ORDER_TABLES,
  buildInsertQuery,
  resolvePostgresEnvConfig,
};
