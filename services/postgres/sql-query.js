const path = require('path');
const fs = require('fs');

// Load environment variables dynamically from services/postgres/.env or backend/.env
let resolvedUser = process.env.POSTGRES_USER;
let resolvedPassword = process.env.POSTGRES_PASSWORD;
let resolvedDatabase = process.env.POSTGRES_DB;
let resolvedHost = process.env.POSTGRES_HOST || 'localhost';
let resolvedPort = parseInt(process.env.POSTGRES_PORT || '5432', 10);

const envFiles = [
  path.resolve(__dirname, './.env'),
  path.resolve(__dirname, '../../backend/.env'),
];

for (const envFile of envFiles) {
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, 'utf8');
    if (!resolvedUser) {
      const match = content.match(/POSTGRES_USER\s*=\s*(.+)/);
      if (match) resolvedUser = match[1].trim();
    }
    if (!resolvedPassword) {
      const match = content.match(/POSTGRES_PASSWORD\s*=\s*(.+)/);
      if (match) resolvedPassword = match[1].trim();
    }
    if (!resolvedDatabase) {
      const match = content.match(/POSTGRES_DB\s*=\s*(.+)/);
      if (match) resolvedDatabase = match[1].trim();
    }
    if (!process.env.POSTGRES_HOST) {
      const match = content.match(/POSTGRES_HOST\s*=\s*(.+)/);
      if (match) resolvedHost = match[1].trim();
    }
    if (!process.env.POSTGRES_PORT) {
      const match = content.match(/POSTGRES_PORT\s*=\s*(.+)/);
      if (match) resolvedPort = parseInt(match[1].trim(), 10);
    }
  }
}

resolvedUser = resolvedUser || 'postgres';
resolvedPassword = resolvedPassword || 'postgres';
resolvedDatabase = resolvedDatabase || 'daily_expense_db';

let pg;
try {
  pg = require('pg');
} catch (e) {
  try {
    pg = require(path.resolve(__dirname, '../../packages/db-postgres/node_modules/pg'));
  } catch (err) {
    try {
      pg = require(path.resolve(__dirname, '../../backend/node_modules/pg'));
    } catch (finalErr) {
      console.error('❌ Error: pg module not found. Please install dependencies.');
      process.exit(1);
    }
  }
}

const { Pool } = pg;
const pool = new Pool({
  user: resolvedUser,
  password: resolvedPassword,
  host: resolvedHost,
  port: resolvedPort,
  database: resolvedDatabase,
});

const query = process.argv.slice(2).join(' ') || `
  SELECT 
    table_name, 
    table_type 
  FROM information_schema.tables 
  WHERE table_schema = 'public'
  ORDER BY table_name;
`;

async function execute() {
  console.log(`🔌 Connecting to PostgreSQL at ${resolvedHost}:${resolvedPort} (Database: ${resolvedDatabase})...`);
  try {
    console.log(`\nExecuting SQL:\n${query}\n`);
    const result = await pool.query(query);

    if (result.rows && result.rows.length > 0) {
      console.table(result.rows);
      console.log(`\n✔ Total Rows: ${result.rows.length}`);
    } else {
      console.log(`✔ Query executed successfully (Command: ${result.command}, RowCount: ${result.rowCount || 0}).`);
    }

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

execute();
