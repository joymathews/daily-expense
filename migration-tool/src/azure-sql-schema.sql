-- =============================================================================
-- Azure SQL Database Schema for Daily Expense Application
-- Compatible with T-SQL / MS SQL Server 2019+ and Azure SQL Database
-- =============================================================================

-- 1. Bronze Table: Raw Inputs
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
END;

-- 2. Silver Table: Extracted Staging Transactions
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
END;

-- 3. Gold Table: Confirmed Transactions Ledger
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
        updated_at DATETIME2 DEFAULT SYSUTCDATETIME(),
    );
    CREATE UNIQUE INDEX UQ_gold_user_silver ON gold_transactions(user_id, silver_tx_id) WHERE silver_tx_id IS NOT NULL;
    CREATE INDEX idx_gold_tx_user_date ON gold_transactions(user_id, transaction_date);
    CREATE INDEX idx_gold_tx_received_at ON gold_transactions(user_id, source_received_at);
END;

-- 4. User Cycles Overrides Table
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
END;

-- 5. LLM Extraction Audit Logs Table
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
END;

-- 6. Payment Methods Table
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
END;

-- 7. Payment Mapping Rules Table
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
END;

-- 8. User Preferences Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'user_preferences')
BEGIN
    CREATE TABLE user_preferences (
        user_id NVARCHAR(255) NOT NULL PRIMARY KEY,
        defaults_seeded BIT DEFAULT 0,
        billing_cycle_start_day INT DEFAULT 17,
        expected_salary DECIMAL(18, 2) DEFAULT 100000.00
    );
END;

-- 9. Fetcher Emails Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'fetcher_emails')
BEGIN
    CREATE TABLE fetcher_emails (
        user_id NVARCHAR(255) NOT NULL,
        email NVARCHAR(255) NOT NULL,
        created_at DATETIME2 DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_fetcher_emails PRIMARY KEY (user_id, email)
    );
    CREATE INDEX idx_fetcher_emails_user ON fetcher_emails(user_id);
END;

-- 10. Fixed Charges Table
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
END;

-- 11. LLM Feedback Settings Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'llm_feedback_settings')
BEGIN
    CREATE TABLE llm_feedback_settings (
        user_id NVARCHAR(255) NOT NULL PRIMARY KEY,
        is_enabled BIT NOT NULL DEFAULT 0,
        max_examples INT NOT NULL DEFAULT 10,
        similarity_threshold FLOAT DEFAULT 0.3,
        updated_at DATETIME2 DEFAULT SYSUTCDATETIME()
    );
END;

-- 12. LLM Correction Examples Table
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
END;
