const path = require('path');
const fs = require('fs');

// Resolve the sqlite3 dependency from the backend directory to avoid root module conflicts
const sqlite3Path = path.resolve(__dirname, '../backend/node_modules/sqlite3');
const sqlite3 = require(sqlite3Path).verbose();

// Path to the SQLite DB file
const dbPath = process.env.DATABASE_URL
  ? path.resolve(process.env.DATABASE_URL)
  : path.resolve(__dirname, '../backend/data/daily_expense.db');

if (!fs.existsSync(dbPath)) {
  console.log(`Database file not found at: ${dbPath}`);
  console.log('Nothing to clear.');
  process.exit(0);
}

console.log(`Connecting to SQLite database at: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  // Enable Foreign Key support
  db.run('PRAGMA foreign_keys = ON;');

  db.run('BEGIN TRANSACTION;', (err) => {
    if (err) {
      console.error('Failed to begin transaction:', err.message);
      db.close();
      process.exit(1);
    }
  });

  console.log('Clearing table records...');

  // Delete records in reverse dependency order
  db.run('DELETE FROM gold_transactions;', (err) => {
    if (err) {
      console.error('Failed to clear gold_transactions:', err.message);
    } else {
      console.log('✔ Cleared gold_transactions (Gold Layer)');
    }
  });

  db.run('DELETE FROM silver_extracted_transactions;', (err) => {
    if (err) {
      console.error('Failed to clear silver_extracted_transactions:', err.message);
    } else {
      console.log('✔ Cleared silver_extracted_transactions (Silver Layer)');
    }
  });

  db.run('DELETE FROM bronze_raw_emails;', (err) => {
    if (err) {
      console.error('Failed to clear bronze_raw_emails:', err.message);
    } else {
      console.log('✔ Cleared bronze_raw_emails (Bronze Layer)');
    }
  });

  db.run('COMMIT;', (err) => {
    if (err) {
      console.error('Failed to commit transaction. Rolling back...', err.message);
      db.run('ROLLBACK;');
    } else {
      console.log('Success: All ingestion data cleared successfully!');
    }
    db.close();
  });
});
