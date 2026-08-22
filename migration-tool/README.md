# Standalone Azure SQL Data Migration & Verification Tool

This is a standalone tool for migrating data from your local **SQLite** database (`./backend/data/daily_expense.db`) to **Azure SQL Database** (T-SQL) with zero data loss and automated audit verification.

---

> 💡 **Need to create a free Azure SQL Database?**  
> Check out the step-by-step [Azure SQL Setup Guide](AZURE_SQL_SETUP_GUIDE.md) to set up a 100% free serverless database.

---

## 🚀 How to Run the Tool

### Step 1: Install Dependencies
Open your terminal and navigate to this folder:
```bash
cd migration-tool
npm install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env` inside the `migration-tool/` folder:
```bash
cp .env.example .env
```

Edit `migration-tool/.env` with your Azure SQL connection details:
```env
SQLITE_DB_PATH=../backend/data/daily_expense.db
AZURE_SQL_SERVER=your-server.database.windows.net
AZURE_SQL_DATABASE=your_database_name
AZURE_SQL_USER=your_username
AZURE_SQL_PASSWORD=your_password
AZURE_SQL_PORT=1433
AZURE_SQL_ENCRYPT=true
```

### Step 3: Run Unit Tests
Validate the migration tool logic:
```bash
npm test
```

### Step 4: Run Data Migration & Verification
Execute the migration and view the verification audit report:
```bash
npm start
```

---

## 📊 Automated Verification Audit Output
The tool will automatically run an audit suite upon completing migration, displaying:
1. **Row Count Audit:** Verifies exact row count match across all 12 tables (`bronze_raw_inputs`, `silver_extracted_transactions`, `gold_transactions`, `user_cycles`, `llm_extraction_logs`, `payment_methods`, `payment_mapping_rules`, `user_preferences`, `fetcher_emails`, `fixed_charges`, `llm_feedback_settings`, `llm_correction_examples`).
2. **Financial Sum Audit:** Sums all active Gold ledger transaction amounts in SQLite vs Azure SQL and asserts a $0.00 difference down to the exact cent.
