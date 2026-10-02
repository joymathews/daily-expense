const path = require('path');
const fs = require('fs');

// 12 Medallion Tables in logical group order
const MEDALLION_TABLES = [
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

function resolveEnvConfig() {
  let resolvedPassword = process.env.AZURE_SQL_PASSWORD || process.env.SA_PASSWORD;
  let resolvedServer = process.env.AZURE_SQL_SERVER;
  let resolvedUser = process.env.AZURE_SQL_USER || process.env.SA_USER;
  let resolvedDatabase = process.env.AZURE_SQL_DATABASE;
  let resolvedPort = process.env.AZURE_SQL_PORT;

  const envFiles = [
    path.resolve(__dirname, '../backend/.env'),
    path.resolve(__dirname, '../services/mssql/.env'),
    path.resolve(__dirname, '../.env'),
  ];

  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      if (!resolvedPassword) {
        const match = content.match(/(?:AZURE_SQL_PASSWORD|SA_PASSWORD)\s*=\s*(.+)/);
        if (match) resolvedPassword = match[1].trim().replace(/^['"]|['"]$/g, '');
      }
      if (!resolvedServer) {
        const match = content.match(/AZURE_SQL_SERVER\s*=\s*(.+)/);
        if (match) resolvedServer = match[1].trim().replace(/^['"]|['"]$/g, '');
      }
      if (!resolvedUser) {
        const match = content.match(/(?:AZURE_SQL_USER|SA_USER)\s*=\s*(.+)/);
        if (match) resolvedUser = match[1].trim().replace(/^['"]|['"]$/g, '');
      }
      if (!resolvedDatabase) {
        const match = content.match(/AZURE_SQL_DATABASE\s*=\s*(.+)/);
        if (match) resolvedDatabase = match[1].trim().replace(/^['"]|['"]$/g, '');
      }
      if (!resolvedPort) {
        const match = content.match(/AZURE_SQL_PORT\s*=\s*(.+)/);
        if (match) resolvedPort = match[1].trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }

  return {
    user: resolvedUser || 'sa',
    password: resolvedPassword || '',
    server: resolvedServer || 'localhost',
    port: parseInt(resolvedPort || '1433', 10),
    database: resolvedDatabase || 'daily_expense_db',
    connectionTimeout: 90000, // 90s for Azure SQL Serverless cold-start / wake-up
    requestTimeout: 90000,
    pool: {
      min: 0,
      max: 5,
      acquireTimeoutMillis: 90000,
    },
    options: {
      encrypt: (resolvedServer && resolvedServer.includes('database.windows.net')) || process.env.AZURE_SQL_ENCRYPT === 'true',
      trustServerCertificate: true,
      connectTimeout: 90000,
    },
  };
}

function getMssqlClient() {
  try {
    return require('mssql');
  } catch (e) {
    try {
      return require(path.resolve(__dirname, '../packages/db-mssql/node_modules/mssql'));
    } catch (err) {
      try {
        return require(path.resolve(__dirname, '../backend/node_modules/mssql'));
      } catch (finalErr) {
        throw new Error('mssql module not found. Please run npm install.');
      }
    }
  }
}

/**
 * Normalizes MSSQL record fields (Date objects to ISO strings, Buffers to strings/json).
 */
function normalizeRecord(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      normalized[key] = value.toISOString();
    } else if (typeof value === 'boolean') {
      normalized[key] = value;
    } else if (typeof value === 'bigint') {
      normalized[key] = value.toString();
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

/**
 * Core export execution function.
 * [FUNC-SYS-10, NFR-DB-6]
 */
async function exportAzureSqlSnapshot(customConfig, customOutputDir) {
  const sql = getMssqlClient();
  const config = customConfig || resolveEnvConfig();

  if (!config.password && !customConfig) {
    throw new Error('Database password not configured. Please check your .env file.');
  }

  const now = new Date();
  const timestampStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseExportDir = customOutputDir || path.resolve(__dirname, '../data/exports');
  const timestampDir = path.join(baseExportDir, `export-${timestampStr}`);
  const latestDir = path.join(baseExportDir, 'latest');

  fs.mkdirSync(timestampDir, { recursive: true });
  fs.mkdirSync(latestDir, { recursive: true });

  console.log(`🔌 Connecting to Azure SQL at ${config.server}:${config.port} (Database: ${config.database})...`);
  const pool = await sql.connect(config);

  const manifest = {
    exportTimestamp: now.toISOString(),
    sourceServer: config.server,
    sourceDatabase: config.database,
    tables: {},
    totalRows: 0,
  };

  const summaryReport = [];

  try {
    for (const tableName of MEDALLION_TABLES) {
      try {
        const query = `SELECT * FROM [dbo].[${tableName}]`;
        const result = await pool.request().query(query);
        const rows = (result.recordset || []).map(normalizeRecord);

        const tableJson = JSON.stringify(rows, null, 2);

        // Write to timestamped folder and latest folder
        fs.writeFileSync(path.join(timestampDir, `${tableName}.json`), tableJson, 'utf8');
        fs.writeFileSync(path.join(latestDir, `${tableName}.json`), tableJson, 'utf8');

        manifest.tables[tableName] = rows.length;
        manifest.totalRows += rows.length;

        summaryReport.push({
          'Table Name': tableName,
          'Rows Exported': rows.length,
          'Status': 'SUCCESS',
        });
      } catch (tableErr) {
        // Handle case where table may not exist yet in source
        manifest.tables[tableName] = 0;
        summaryReport.push({
          'Table Name': tableName,
          'Rows Exported': 0,
          'Status': `SKIPPED (${tableErr.message.split('\n')[0].slice(0, 30)})`,
        });
        fs.writeFileSync(path.join(timestampDir, `${tableName}.json`), '[]', 'utf8');
        fs.writeFileSync(path.join(latestDir, `${tableName}.json`), '[]', 'utf8');
      }
    }

    const manifestJson = JSON.stringify(manifest, null, 2);
    fs.writeFileSync(path.join(timestampDir, 'manifest.json'), manifestJson, 'utf8');
    fs.writeFileSync(path.join(latestDir, 'manifest.json'), manifestJson, 'utf8');

    return { manifest, timestampDir, latestDir, summaryReport };
  } finally {
    await pool.close();
  }
}

if (require.main === module) {
  (async () => {
    try {
      const result = await exportAzureSqlSnapshot();
      console.log('\n========================================');
      console.log('   AZURE SQL DATA EXPORT COMPLETED      ');
      console.log('========================================\n');
      console.table(result.summaryReport);
      console.log(`\n✔ Total Records Exported: ${result.manifest.totalRows}`);
      console.log(`📁 Dump Directory: ${result.timestampDir}`);
      console.log(`📁 Latest Snapshot: ${result.latestDir}\n`);
      process.exit(0);
    } catch (err) {
      console.error(`\n❌ Export Failed: ${err.message}`);
      process.exit(1);
    }
  })();
}

module.exports = {
  exportAzureSqlSnapshot,
  MEDALLION_TABLES,
  normalizeRecord,
  resolveEnvConfig,
};
