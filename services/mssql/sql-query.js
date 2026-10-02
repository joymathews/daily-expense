const path = require('path');
const fs = require('fs');

// Load environment variables dynamically from .env in this folder or backend/.env
let resolvedPassword = process.env.AZURE_SQL_PASSWORD || process.env.SA_PASSWORD;

if (!resolvedPassword) {
  const envFiles = [
    path.resolve(__dirname, './.env'),
    path.resolve(__dirname, '../../backend/.env'),
  ];

  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      const match = content.match(/(?:AZURE_SQL_PASSWORD|SA_PASSWORD)\s*=\s*(.+)/);
      if (match) {
        resolvedPassword = match[1].trim();
        break;
      }
    }
  }
}

if (!resolvedPassword) {
  console.error('❌ Error: Database password not found. Please set AZURE_SQL_PASSWORD or SA_PASSWORD in your environment or .env file.');
  process.exit(1);
}

const sql = require(path.resolve(__dirname, '../../backend/node_modules/mssql'));

const config = {
  user: process.env.AZURE_SQL_USER || process.env.SA_USER || 'sa',
  password: resolvedPassword,
  server: process.env.AZURE_SQL_SERVER || 'localhost',
  port: parseInt(process.env.AZURE_SQL_PORT || '1433', 10),
  database: process.env.AZURE_SQL_DATABASE || 'master',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const query = process.argv.slice(2).join(' ') || `
  SELECT 
    name AS [Database Name], 
    create_date AS [Created Date], 
    state_desc AS [Status]
  FROM sys.databases;
`;

async function execute() {
  console.log(`🔌 Connecting to SQL Server at ${config.server}:${config.port} (Database: ${config.database})...`);
  try {
    const pool = await sql.connect(config);
    console.log(`\nExecuting SQL:\n${query}\n`);
    const result = await pool.request().query(query);

    if (result.recordset && result.recordset.length > 0) {
      console.table(result.recordset);
      console.log(`\n✔ Total Rows: ${result.recordset.length}`);
    } else {
      console.log('✔ Query executed successfully (No rows returned or DDL statement completed).');
    }

    await pool.close();
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

execute();
