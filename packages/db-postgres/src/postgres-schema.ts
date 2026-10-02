import { Pool } from 'pg';

export const POSTGRES_SCHEMA_DDL = `
-- 1. Bronze Layer (Raw Inputs)
CREATE TABLE IF NOT EXISTS bronze_raw_inputs (
  id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  sender VARCHAR(255) NOT NULL,
  title VARCHAR(500) NOT NULL,
  snippet TEXT,
  raw_body TEXT NOT NULL,
  raw_payload TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  has_transaction BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(50) DEFAULT 'unprocessed' CHECK (status IN ('unprocessed', 'processed', 'rejected')),
  ingested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_bronze_user_status ON bronze_raw_inputs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_bronze_user_received ON bronze_raw_inputs(user_id, received_at DESC);

-- 2. Silver Layer (Extracted Staging Queue)
CREATE TABLE IF NOT EXISTS silver_extracted_transactions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  bronze_input_id VARCHAR(255) NOT NULL,
  source_type VARCHAR(50) NOT NULL DEFAULT 'email',
  merchant_raw VARCHAR(255) NOT NULL,
  merchant_normalized VARCHAR(255),
  amount_cents BIGINT NOT NULL,
  currency VARCHAR(10) NOT NULL,
  transaction_date DATE NOT NULL,
  inferred_category VARCHAR(100),
  confidence_score NUMERIC(5, 2),
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'error')),
  extracted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  source_title VARCHAR(500),
  source_sender VARCHAR(255),
  source_received_at TIMESTAMPTZ,
  payment_method VARCHAR(100),
  payment_method_raw VARCHAR(100),
  transaction_type VARCHAR(50) DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund', 'transfer', 'fixed')),
  parent_transaction_id VARCHAR(64),
  CONSTRAINT fk_silver_bronze FOREIGN KEY (user_id, bronze_input_id)
    REFERENCES bronze_raw_inputs(user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_silver_user_status ON silver_extracted_transactions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_silver_user_date ON silver_extracted_transactions(user_id, transaction_date DESC);

-- 3. Gold Layer (Confirmed Ledger)
CREATE TABLE IF NOT EXISTS gold_transactions (
  id VARCHAR(64) PRIMARY KEY,
  pending_tx_id VARCHAR(64),
  user_id VARCHAR(255) NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  merchant VARCHAR(255) NOT NULL,
  amount_cents BIGINT NOT NULL,
  currency VARCHAR(10) NOT NULL,
  transaction_date DATE NOT NULL,
  category VARCHAR(100) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  source_title VARCHAR(500),
  source_sender VARCHAR(255),
  source_received_at TIMESTAMPTZ,
  bronze_input_id VARCHAR(255),
  payment_method VARCHAR(100),
  transaction_type VARCHAR(50) DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund', 'transfer', 'fixed')),
  parent_transaction_id VARCHAR(64),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gold_user_date ON gold_transactions(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_gold_user_category ON gold_transactions(user_id, category);

-- 4. Payment Standardization
CREATE TABLE IF NOT EXISTS payment_methods (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS payment_mapping_rules (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  alias_pattern VARCHAR(255) NOT NULL,
  payment_method_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rule_method FOREIGN KEY (payment_method_id)
    REFERENCES payment_methods(id) ON DELETE CASCADE,
  UNIQUE(user_id, alias_pattern)
);

-- 5. User Preferences & Fetcher Emails
CREATE TABLE IF NOT EXISTS fetcher_emails (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, email)
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id VARCHAR(255) PRIMARY KEY,
  billing_cycle_start_day INT NOT NULL DEFAULT 1 CHECK (billing_cycle_start_day BETWEEN 1 AND 31),
  expected_salary NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. Cycle Overrides
CREATE TABLE IF NOT EXISTS cycle_override (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  cycle_name VARCHAR(100),
  start_type VARCHAR(50) NOT NULL CHECK (start_type IN ('default', 'transaction', 'date')),
  start_transaction_id VARCHAR(64),
  start_date DATE NOT NULL,
  start_timestamp TIMESTAMPTZ NOT NULL,
  end_date DATE,
  end_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cycle_user_start ON cycle_override(user_id, start_date DESC);

-- 7. Fixed Charges
CREATE TABLE IF NOT EXISTS fixed_charges (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  amount_cents BIGINT NOT NULL,
  currency VARCHAR(10) NOT NULL,
  category VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  payment_method VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 8. LLM Extraction Logs & Feedback Learning
CREATE TABLE IF NOT EXISTS llm_extraction_logs (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  bronze_input_id VARCHAR(255) NOT NULL,
  extracted_merchant VARCHAR(255),
  extracted_amount_cents BIGINT,
  extracted_currency VARCHAR(10),
  extracted_date VARCHAR(50),
  extracted_category VARCHAR(100),
  extracted_payment_method VARCHAR(100),
  extracted_transaction_type VARCHAR(50) DEFAULT 'expense' CHECK (extracted_transaction_type IN ('expense', 'refund', 'transfer', 'fixed')),
  confidence_score NUMERIC(5, 2),
  extracted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  raw_email_snippet TEXT,
  extracted_json JSONB,
  model_name VARCHAR(100),
  latency_ms INT,
  CONSTRAINT fk_llm_logs_bronze FOREIGN KEY (user_id, bronze_input_id) REFERENCES bronze_raw_inputs(user_id, id) ON DELETE CASCADE,
  CONSTRAINT uq_llm_logs_bronze UNIQUE (user_id, bronze_input_id)
);

CREATE INDEX IF NOT EXISTS idx_llm_logs_bronze ON llm_extraction_logs(user_id, bronze_input_id);

CREATE TABLE IF NOT EXISTS feedback_settings (
  user_id VARCHAR(255) PRIMARY KEY,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  max_examples INT NOT NULL DEFAULT 10,
  similarity_threshold NUMERIC(4, 2) DEFAULT 0.70,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS correction_examples (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  bronze_input_id VARCHAR(255) NOT NULL,
  field_name VARCHAR(50) NOT NULL,
  llm_value TEXT,
  corrected_value TEXT NOT NULL,
  email_snippet TEXT,
  embedding JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, bronze_input_id, field_name)
);
`;

export async function initializePostgresSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(POSTGRES_SCHEMA_DDL);
  } finally {
    client.release();
  }
}
