# SQLite Database Schema & Reference Manual

This document provides a comprehensive technical overview of the SQLite database schema for the **Daily Expense** application. It details every table, data type, key relationship, index, data validation constraint, and the **User Isolation Standard** that enforces data security.

---

## Architectural Principles

1. **Medallion Data Pipeline Structure**: 
   The database is organized into three distinct stages of data evolution:
   - **Bronze Layer (`bronze_raw_inputs`)**: Raw data ingestion. Retains the original receipt email content or manual input text.
   - **Silver Layer (`silver_extracted_transactions`)**: Staging and parsing area. Holds extracted fields pending user correction, validation, and status reviews.
   - **Gold Layer (`gold_transactions`)**: Confirmed double-entry ledger. Finalized transactions used for financial analysis, dashboards, and reporting.
2. **User Isolation Standard**:
   Every database table partitions records by a `user_id` field. The `user_id` is extracted from the secure AWS Cognito JWT sub claim (`req.auth.sub`). Any SELECT, INSERT, UPDATE, or DELETE query must strictly filter or constrain records by the authenticated user's ID to prevent cross-user data exposure.
3. **Floating-Point Avoidance (Amount Cents)**:
   To prevent IEEE 754 floating-point rounding errors during mathematical aggregates, all financial amounts are stored as integers representing **cents** or the lowest currency denomination (e.g., `$10.50` is stored as `1050`).
4. **Standardized Normalization**:
   Payment methods and mapping alias rules allow raw string patterns to normalize automatically into standard options before entering the Silver and Gold layers.

---

## Database Tables Reference

### 1. `bronze_raw_inputs` (Bronze Ingestion Layer)
This table acts as the raw ingestion sink. It stores receipt emails fetched via the Gmail API or manual raw receipt descriptions.

#### Schema Definition
```sql
CREATE TABLE IF NOT EXISTS bronze_raw_inputs (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  sender TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT,
  raw_body TEXT NOT NULL,
  raw_payload TEXT,
  received_at TEXT NOT NULL,
  has_transaction INTEGER NOT NULL DEFAULT 1,
  status TEXT DEFAULT 'unprocessed' CHECK (status IN ('unprocessed', 'processed', 'rejected')),
  ingested_at TEXT DEFAULT (datetime('now', 'utc')),
  deleted_at TEXT,
  PRIMARY KEY (user_id, id)
);
```

#### Fields Justification & Purpose
| Column Name | Data Type | Key / Constraints | Description / Business Justification |
| :--- | :--- | :--- | :--- |
| **`id`** | `TEXT` | `PRIMARY KEY (Part 2)` | Unique identifier of the raw source. For emails, this maps directly to the unique Gmail API Message ID. For manual entry, it is a randomly generated uuid. |
| **`user_id`** | `TEXT` | `PRIMARY KEY (Part 1)` | AWS Cognito user identity unique ID. Establishes the partition boundary for multi-tenant data privacy. |
| **`source_type`** | `TEXT` | `NOT NULL` | The entry mechanism identifier. Stores `'email'` for records ingested via Gmail API, and `'manual'` for direct ledger creations. |
| **`sender`** | `TEXT` | `NOT NULL` | The email address of the message sender (e.g., `support@merchant.com`). For manual direct entries, it defaults to `'User Direct'`. Helps identify source merchants. |
| **`title`** | `TEXT` | `NOT NULL` | The email subject line or raw header identifier. Serves as the primary title in lists and review modals. |
| **`snippet`** | `TEXT` | `Nullable` | A brief plain-text excerpt of the raw data. Displayed in high-density listings so users get quick context without reloading the full body text. |
| **`raw_body`** | `TEXT` | `NOT NULL` | The complete plain-text message body or raw descriptive block. This content is passed to LLM modules for detail extraction and rendered in the lineage trace. |
| **`raw_payload`** | `TEXT` | `Nullable` | A raw JSON serialization dump of the API payload (Gmail headers, metadata, etc.). Retained for diagnostics and audit logging. |
| **`received_at`** | `TEXT` | `NOT NULL` | ISO-8601 string indicating when the email or raw record was received/recorded. Crucial for timeline filters and date sorting. |
| **`has_transaction`** | `INTEGER` | `NOT NULL DEFAULT 1` | A binary flag (`1` for true, `0` for false) classifying if the item is a financial transaction. Used to filter out spam or non-receipt emails. |
| **`status`** | `TEXT` | `CHECK (unprocessed, processed, rejected)` | Processing state. Tracks pipeline progress. `'unprocessed'` items await extraction; `'processed'` items have been staging-analyzed; `'rejected'` items are ignored by ingestion. |
| **`ingested_at`** | `TEXT` | `DEFAULT UTC Timestamp` | Audit timestamp showing exactly when the row was recorded in the database. |
| **`deleted_at`** | `TEXT` | `Nullable` | ISO-8601 timestamp representing soft-delete status. If populated, the item is moved to the Trash Bin and hidden from active views. |

---

### 2. `silver_extracted_transactions` (Silver Staging Layer)
Acts as the staging queue. It stores parsed key-value transaction properties extracted from Bronze raw inputs.

#### Schema Definition
```sql
CREATE TABLE IF NOT EXISTS silver_extracted_transactions (
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
  FOREIGN KEY (user_id, bronze_input_id) REFERENCES bronze_raw_inputs(user_id, id) ON DELETE CASCADE,
  UNIQUE(user_id, bronze_input_id),
  UNIQUE(user_id, id)
);
```

#### Fields Justification & Purpose
| Column Name | Data Type | Key / Constraints | Description / Business Justification |
| :--- | :--- | :--- | :--- |
| **`id`** | `TEXT` | `PRIMARY KEY` | Unique UUID generated for the staging transaction record. |
| **`user_id`** | `TEXT` | `NOT NULL` | AWS Cognito user sub. Partitions staging items. |
| **`bronze_input_id`**| `TEXT` | `FOREIGN KEY` | References the parent raw input in the Bronze layer. Forms the Medallion data lineage link. Cascades deletion. |
| **`source_type`** | `TEXT` | `DEFAULT 'email'` | Classification of the transaction source (e.g. `'email'`, `'manual'`). |
| **`merchant_raw`** | `TEXT` | `NOT NULL` | The unmodified merchant name extracted directly from the receipt content by the parser. |
| **`merchant_normalized`**| `TEXT`| `Nullable` | Normalized or user-corrected merchant spelling. Used as the default name when promoting the transaction. |
| **`amount_cents`** | `INTEGER` | `NOT NULL` | Staged amount stored in cents. For instance, `$99.95` stores `9995`. Avoids floating-point math errors. |
| **`currency`** | `TEXT` | `NOT NULL` | 3-letter currency code (e.g., `USD`, `INR`, `EUR`). |
| **`transaction_date`**| `TEXT` | `NOT NULL` | The parsed date the transaction took place. |
| **`inferred_category`**| `TEXT`| `Nullable` | Inferred transaction category based on merchant classification (e.g. `Travel`, `Food`). |
| **`confidence_score`**| `REAL` | `Nullable` | Numeric value (0.0 to 1.0) indicating LLM extraction confidence. |
| **`status`** | `TEXT` | `CHECK (pending, approved, rejected, error)` | Current review status. `'pending'` represents extracted and validated items; `'error'` highlights missing required fields; `'approved'` matches items promoted to Gold; `'rejected'` items are staging-dismissed. |
| **`payment_method`** | `TEXT` | `Nullable` | Normalized payment channel (e.g. `Credit Card`, `UPI`). |
| **`transaction_type`**| `TEXT` | `DEFAULT 'expense'` | Represents whether this is an `'expense'` (payment), a `'refund'` (offset reversal), or a `'transfer'` (movement between the user's own accounts). Transfers are excluded from all expense totals and aggregates. |
| **`parent_transaction_id`**| `TEXT`| `Nullable` | In the case of a refund, references the matching parent purchase ID to correctly calculate credit balances. |
| **`deleted_at`** | `TEXT` | `Nullable` | Soft-delete ISO-8601 timestamp for trash recovery. |
| **`extracted_at`** | `TEXT` | `DEFAULT UTC Timestamp` | Creation timestamp indicating when parsing was executed. |

---

### 3. `gold_transactions` (Gold Confirmed Ledger)
Contains confirmed double-entry ledger entries. Holds final user-corrected data.

#### Schema Definition
```sql
CREATE TABLE IF NOT EXISTS gold_transactions (
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
  FOREIGN KEY (user_id, silver_tx_id) REFERENCES silver_extracted_transactions(user_id, id) ON DELETE SET NULL,
  FOREIGN KEY (user_id, parent_transaction_id) REFERENCES gold_transactions(user_id, id) ON DELETE SET NULL,
  UNIQUE(user_id, id)
);
```

#### Fields Justification & Purpose
| Column Name | Data Type | Key / Constraints | Description / Business Justification |
| :--- | :--- | :--- | :--- |
| **`id`** | `TEXT` | `PRIMARY KEY` | Unique UUID generated for the confirmed ledger transaction. |
| **`silver_tx_id`** | `TEXT` | `UNIQUE, FOREIGN KEY`| References the matching Silver staging record. Forms the lineage lineage from staging back to source. If staging is deleted, this is set to NULL. |
| **`user_id`** | `TEXT` | `NOT NULL` | AWS Cognito user sub. Partitions ledger entries. |
| **`source_type`** | `TEXT` | `DEFAULT 'email'` | Classification of the confirmation source (e.g. `'manual'`, `'email'`). |
| **`merchant`** | `TEXT` | `NOT NULL` | The finalized, user-corrected name of the merchant. |
| **`amount_cents`** | `INTEGER` | `NOT NULL` | Confirmed transaction value stored as cents. |
| **`currency`** | `TEXT` | `NOT NULL` | Confirmed currency identifier. |
| **`transaction_date`**| `TEXT` | `NOT NULL` | The date of the transaction. |
| **`category`** | `TEXT` | `NOT NULL` | Confirmed transaction category (e.g. `Travel`, `Shopping`). |
| **`notes`** | `TEXT` | `Nullable` | Freeform notes, annotations, or comments appended by the user during review. |
| **`payment_method`** | `TEXT` | `Nullable` | Standardized payment channel verified by the user. |
| **`transaction_type`**| `TEXT` | `DEFAULT 'expense'` | Transaction type designation (`'expense'`, `'refund'`, or `'transfer'`). Refunds are evaluated as negative deductions from category aggregates. Transfers represent own-account movements and are entirely excluded from all expense totals, dashboard metrics, and currency aggregate summaries. |
| **`parent_transaction_id`**| `TEXT`| `FOREIGN KEY` | References another verified transaction inside `gold_transactions`. Used to chain credit offsets to parent purchases. |
| **`deleted_at`** | `TEXT` | `Nullable` | Soft-delete ISO-8601 timestamp. Supports trash and recovery. |
| **`created_at`** | `TEXT` | `DEFAULT UTC Timestamp` | Timestamp tracking when the entry was finalized and approved. |
| **`updated_at`** | `TEXT` | `DEFAULT UTC Timestamp` | Timestamp tracking the last modification or correction time. |

---

### 4. `payment_methods` (Standardization Reference)
Stores standardized payment channels defined by users.

#### Schema Definition
```sql
CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'utc')),
  UNIQUE(user_id, name)
);
```

#### Fields Justification & Purpose
| Column Name | Data Type | Key / Constraints | Description / Business Justification |
| :--- | :--- | :--- | :--- |
| **`id`** | `TEXT` | `PRIMARY KEY` | Unique ID generated for the payment method registry. |
| **`user_id`** | `TEXT` | `NOT NULL` | AWS Cognito sub. Payment configuration is user-specific. |
| **`name`** | `TEXT` | `NOT NULL, UNIQUE` | The user's standardized payment method name (e.g. `'Amex Credit Card'`). Populates standard form dropdown selections. |
| **`created_at`** | `TEXT` | `DEFAULT UTC Timestamp` | Audit log of method creation. |

---

### 5. `payment_mapping_rules` (Standardization Alias Rules)
Stores rules that map parsed billing method strings to standardized payment method rows.

#### Schema Definition
```sql
CREATE TABLE IF NOT EXISTS payment_mapping_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  alias_pattern TEXT NOT NULL,
  payment_method_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'utc')),
  FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE CASCADE,
  UNIQUE(user_id, alias_pattern)
);
```

#### Fields Justification & Purpose
| Column Name | Data Type | Key / Constraints | Description / Business Justification |
| :--- | :--- | :--- | :--- |
| **`id`** | `TEXT` | `PRIMARY KEY` | Unique ID generated for the mapping rule. |
| **`user_id`** | `TEXT` | `NOT NULL` | AWS Cognito user sub. Rules configurations are user-specific. |
| **`alias_pattern`** | `TEXT` | `NOT NULL, UNIQUE` | Text substring or match pattern (e.g., `'hdfc'`, `'visa'`) found during raw message ingestion. |
| **`payment_method_id`**| `TEXT` | `FOREIGN KEY` | The reference standardized payment method ID in `payment_methods`. If match pattern matches during extraction, method defaults to this ID. Cascades on method deletion. |
| **`created_at`** | `TEXT` | `DEFAULT UTC Timestamp` | Audit log of rule creation. |

---

### 6. `llm_extraction_logs` (Extraction Snapshot Audit Log)
Stores an immutable snapshot of LLM parsed details for a raw input to track and measure LLM accuracy.

#### Schema Definition
```sql
CREATE TABLE IF NOT EXISTS llm_extraction_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bronze_input_id TEXT NOT NULL UNIQUE,
  extracted_merchant TEXT,
  extracted_amount_cents INTEGER,
  extracted_currency TEXT,
  extracted_date TEXT,
  extracted_category TEXT,
  extracted_payment_method TEXT,
  extracted_transaction_type TEXT DEFAULT 'expense' CHECK (extracted_transaction_type IN ('expense', 'refund')),
  confidence_score REAL,
  extracted_at TEXT DEFAULT (datetime('now', 'utc')),
  FOREIGN KEY (user_id, bronze_input_id) REFERENCES bronze_raw_inputs(user_id, id) ON DELETE CASCADE,
  UNIQUE(user_id, bronze_input_id),
  UNIQUE(user_id, id)
);
```

#### Fields Justification & Purpose
| Column Name | Data Type | Key / Constraints | Description / Business Justification |
| :--- | :--- | :--- | :--- |
| **`id`** | `TEXT` | `PRIMARY KEY` | Unique UUID generated for the audit log record. |
| **`user_id`** | `TEXT` | `NOT NULL` | AWS Cognito user sub. Partitions extraction logs by user. |
| **`bronze_input_id`**| `TEXT` | `UNIQUE, FOREIGN KEY` | References the Bronze raw input parent record. Ensures one extraction snapshot log exists per processed raw item. |
| **`extracted_merchant`**| `TEXT` | `Nullable` | Original merchant name parsed by the LLM before any user modifications. |
| **`extracted_amount_cents`**| `INTEGER`| `Nullable` | Original transaction amount (in cents) extracted by the LLM. |
| **`extracted_currency`**| `TEXT` | `Nullable` | Original currency extracted by the LLM. |
| **`extracted_date`** | `TEXT` | `Nullable` | Original transaction date parsed by the LLM. |
| **`extracted_category`**| `TEXT` | `Nullable` | Original category inferred by the LLM. |
| **`extracted_payment_method`**| `TEXT`| `Nullable` | Original raw payment method string extracted by the LLM. |
| **`extracted_transaction_type`**| `TEXT` | `CHECK (expense, refund)`| Original transaction type inferred by the LLM (`'expense'` or `'refund'`). |
| **`confidence_score`**| `REAL` | `Nullable` | LLM parsing confidence score (0.0 to 1.0) for validation metrics. |
| **`extracted_at`** | `TEXT` | `DEFAULT UTC Timestamp` | Audit log creation timestamp. |

---

### 7. `user_preferences` (Metadata & Seeding Preferences)
Tracks user-specific configuration flags, such as whether default payment methods have been seeded.

#### Schema Definition
```sql
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  defaults_seeded INTEGER DEFAULT 0
);
```

#### Fields Justification & Purpose
| Column Name | Data Type | Key / Constraints | Description / Business Justification |
| :--- | :--- | :--- | :--- |
| **`user_id`** | `TEXT` | `PRIMARY KEY` | AWS Cognito user sub. Partitions user preferences. |
| **`defaults_seeded`** | `INTEGER` | `DEFAULT 0` | Flag (`1` for true, `0` for false) indicating whether default payment methods and mapping rules have been populated for this user. Prevents auto-reseeding deleted methods. |

---

### 8. `fetcher_emails` (Persistent Fetcher Sender Emails)
Stores sender email addresses inputted or used by the user for fetching receipt emails.

#### Schema Definition
```sql
CREATE TABLE IF NOT EXISTS fetcher_emails (
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'utc')),
  PRIMARY KEY (user_id, email)
);
```

#### Fields Justification & Purpose
| Column Name | Data Type | Key / Constraints | Description / Business Justification |
| :--- | :--- | :--- | :--- |
| **`user_id`** | `TEXT` | `PRIMARY KEY (Part 1)` | AWS Cognito user unique ID. Enforces data isolation between users. |
| **`email`** | `TEXT` | `PRIMARY KEY (Part 2)` | The sender email address. Composite primary key prevents duplicates per user. |
| **`created_at`** | `TEXT` | `DEFAULT UTC Timestamp` | Audit log of email address creation. |

---

## Indexes Reference

To optimize performance and query speeds, the following custom database indexes are defined:

1. **`idx_bronze_inputs_sender`**:
   - *Query*: `CREATE INDEX IF NOT EXISTS idx_bronze_inputs_sender ON bronze_raw_inputs(sender);`
   - *Justification*: Optimizes filtering, grouping, and searching raw receipts based on sender addresses when tracing sources.
2. **`idx_silver_tx_status`**:
   - *Query*: `CREATE INDEX IF NOT EXISTS idx_silver_tx_status ON silver_extracted_transactions(status);`
   - *Justification*: Accelerates retrieval of pending review rows and error logs in staging tables, reducing table scan latency.
3. **`idx_gold_tx_user_date`**:
   - *Query*: `CREATE INDEX IF NOT EXISTS idx_gold_tx_user_date ON gold_transactions(user_id, transaction_date);`
   - *Justification*: Essential index for Ledger pages. Optimizes range searches, search queries, pagination, and total sum aggregates grouped by transaction dates and currencies.
4. **`idx_payment_methods_user`**:
   - *Query*: `CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON payment_methods(user_id);`
   - *Justification*: Rapid lookup of standardized payment methods for form selections.
5. **`idx_payment_rules_user`**:
   - *Query*: `CREATE INDEX IF NOT EXISTS idx_payment_rules_user ON payment_mapping_rules(user_id);`
   - *Justification*: Optimizes ingestion mapping loops where a user's alias rules are compared against extracted data.
6. **`idx_llm_logs_bronze`**:
   - *Query*: `CREATE INDEX IF NOT EXISTS idx_llm_logs_bronze ON llm_extraction_logs(user_id, bronze_input_id);`
   - *Justification*: Optimizes lookup of immutable LLM logs when displaying the side-by-side comparison inside detail modals.
7. **`idx_fetcher_emails_user`**:
   - *Query*: `CREATE INDEX IF NOT EXISTS idx_fetcher_emails_user ON fetcher_emails(user_id);`
   - *Justification*: Rapid lookup of stored fetcher email addresses for datalist autocomplete displays.
8. **`idx_correction_examples_user`**:
   - *Query*: `CREATE INDEX IF NOT EXISTS idx_correction_examples_user ON llm_correction_examples(user_id, created_at DESC);`
   - *Justification*: Optimizes the hot path of fetching the most-recent N correction examples per user at extraction time.

---

### 9. `llm_feedback_settings` (LLM Feedback Learning Configuration)
Stores per-user configuration for the LLM Feedback Learning feature.

#### Schema Definition
```sql
CREATE TABLE IF NOT EXISTS llm_feedback_settings (
  user_id TEXT PRIMARY KEY,
  is_enabled INTEGER NOT NULL DEFAULT 0,
  max_examples INTEGER NOT NULL DEFAULT 10,
  updated_at TEXT DEFAULT (datetime('now', 'utc'))
);
```

#### Fields Justification & Purpose
| Column Name | Data Type | Key / Constraints | Description / Business Justification |
| :--- | :--- | :--- | :--- |
| **`user_id`** | `TEXT` | `PRIMARY KEY` | AWS Cognito user sub. Partitions feedback configuration by user. |
| **`is_enabled`** | `INTEGER` | `NOT NULL DEFAULT 0` | Binary flag (`1` enabled, `0` disabled). Controls whether correction examples are captured and injected. Off by default so the feature is opt-in. |
| **`max_examples`** | `INTEGER` | `NOT NULL DEFAULT 10` | Maximum number of recent correction examples to inject into the LLM system prompt at extraction time. Configurable 1-50. |
| **`updated_at`** | `TEXT` | `DEFAULT UTC Timestamp` | Audit timestamp of the last settings change. |

---

### 10. `llm_correction_examples` (LLM Feedback Correction Examples)
Stores field-level correction examples captured from user edits at the Silver and Gold stages. Used to enrich future LLM extraction prompts.

#### Schema Definition
```sql
CREATE TABLE IF NOT EXISTS llm_correction_examples (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bronze_input_id TEXT NOT NULL,
  field_name TEXT NOT NULL CHECK (field_name IN ('merchant', 'category', 'paymentMethod', 'transactionType')),
  llm_value TEXT,
  corrected_value TEXT NOT NULL,
  email_snippet TEXT,
  created_at TEXT DEFAULT (datetime('now', 'utc')),
  FOREIGN KEY (user_id, bronze_input_id) REFERENCES bronze_raw_inputs(user_id, id) ON DELETE CASCADE,
  UNIQUE(user_id, bronze_input_id, field_name)
);
```

#### Fields Justification & Purpose
| Column Name | Data Type | Key / Constraints | Description / Business Justification |
| :--- | :--- | :--- | :--- |
| **`id`** | `TEXT` | `PRIMARY KEY` | Unique UUID generated for each correction example record. |
| **`user_id`** | `TEXT` | `NOT NULL` | AWS Cognito user sub. Enforces data isolation between users. |
| **`bronze_input_id`** | `TEXT` | `NOT NULL, FOREIGN KEY` | References the originating Bronze raw input. Cascades deletion when the source raw email is deleted. |
| **`field_name`** | `TEXT` | `CHECK (merchant, category, paymentMethod, transactionType)` | The specific extracted field that was corrected. Only inference-based fields are tracked. |
| **`llm_value`** | `TEXT` | `Nullable` | The original value extracted by the LLM. Null if the LLM returned no value. |
| **`corrected_value`** | `TEXT` | `NOT NULL` | The final user-corrected value saved to Silver or Gold. The ground-truth value taught to the LLM. |
| **`email_snippet`** | `TEXT` | `Nullable` | A truncated prefix (~300 chars) of the raw email body, providing semantic context in the few-shot prompt block. |
| **`created_at`** | `TEXT` | `DEFAULT UTC Timestamp` | Timestamp of correction. Used for ordering to retrieve the most-recent N examples. |
