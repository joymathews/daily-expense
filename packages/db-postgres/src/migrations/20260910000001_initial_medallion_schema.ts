import type { Knex } from 'knex';

/**
 * [FUNC-SYS-9] [NFR-DB-5] Initial Medallion Pipeline Schema Migration for PostgreSQL
 * Encapsulates all 12 core tables: Bronze, Silver, Gold, Rules, Preferences, Cycles, Fixed Charges, Feedback
 */
export async function up(knex: Knex): Promise<void> {
  // 1. Bronze Layer (Raw Inputs)
  await knex.schema.createTable('bronze_raw_inputs', (table) => {
    table.string('id', 255).notNullable();
    table.string('user_id', 255).notNullable();
    table.string('source_type', 50).notNullable();
    table.string('sender', 255).notNullable();
    table.string('title', 500).notNullable();
    table.text('snippet').nullable();
    table.text('raw_body').notNullable();
    table.text('raw_payload').nullable();
    table.timestamp('received_at', { useTz: true }).notNullable();
    table.boolean('has_transaction').notNullable().defaultTo(true);
    table.string('status', 50).defaultTo('unprocessed');
    table.timestamp('ingested_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('deleted_at', { useTz: true }).nullable();

    table.primary(['user_id', 'id']);
    table.index(['user_id', 'status'], 'idx_bronze_user_status');
    table.index(['user_id', 'received_at'], 'idx_bronze_user_received');
  });

  // 2. Silver Layer (Extracted Staging Queue)
  await knex.schema.createTable('silver_extracted_transactions', (table) => {
    table.string('id', 64).primary();
    table.string('user_id', 255).notNullable();
    table.string('bronze_input_id', 255).notNullable();
    table.string('source_type', 50).notNullable().defaultTo('email');
    table.string('merchant_raw', 255).notNullable();
    table.string('merchant_normalized', 255).nullable();
    table.bigInteger('amount_cents').notNullable();
    table.string('currency', 10).notNullable();
    table.date('transaction_date').notNullable();
    table.string('inferred_category', 100).nullable();
    table.decimal('confidence_score', 5, 2).nullable();
    table.string('status', 50).notNullable().defaultTo('pending');
    table.timestamp('extracted_at', { useTz: true }).defaultTo(knex.fn.now());
    table.string('source_title', 500).nullable();
    table.string('source_sender', 255).nullable();
    table.timestamp('source_received_at', { useTz: true }).nullable();
    table.string('payment_method', 100).nullable();
    table.string('payment_method_raw', 100).nullable();
    table.string('transaction_type', 50).defaultTo('expense');
    table.string('parent_transaction_id', 64).nullable();

    table.foreign(['user_id', 'bronze_input_id'], 'fk_silver_bronze')
      .references(['user_id', 'id'])
      .inTable('bronze_raw_inputs')
      .onDelete('CASCADE');

    table.index(['user_id', 'status'], 'idx_silver_user_status');
    table.index(['user_id', 'transaction_date'], 'idx_silver_user_date');
  });

  // 3. Gold Layer (Confirmed Ledger)
  await knex.schema.createTable('gold_transactions', (table) => {
    table.string('id', 64).primary();
    table.string('pending_tx_id', 64).nullable();
    table.string('user_id', 255).notNullable();
    table.string('source_type', 50).notNullable();
    table.string('merchant', 255).notNullable();
    table.bigInteger('amount_cents').notNullable();
    table.string('currency', 10).notNullable();
    table.date('transaction_date').notNullable();
    table.string('category', 100).notNullable();
    table.text('notes').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    table.string('source_title', 500).nullable();
    table.string('source_sender', 255).nullable();
    table.timestamp('source_received_at', { useTz: true }).nullable();
    table.string('bronze_input_id', 255).nullable();
    table.string('payment_method', 100).nullable();
    table.string('transaction_type', 50).defaultTo('expense');
    table.string('parent_transaction_id', 64).nullable();
    table.timestamp('deleted_at', { useTz: true }).nullable();

    table.index(['user_id', 'transaction_date'], 'idx_gold_user_date');
    table.index(['user_id', 'category'], 'idx_gold_user_category');
  });

  // 4. Payment Standardization
  await knex.schema.createTable('payment_methods', (table) => {
    table.string('id', 64).primary();
    table.string('user_id', 255).notNullable();
    table.string('name', 100).notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.unique(['user_id', 'name']);
  });

  await knex.schema.createTable('payment_mapping_rules', (table) => {
    table.string('id', 64).primary();
    table.string('user_id', 255).notNullable();
    table.string('alias_pattern', 255).notNullable();
    table.string('payment_method_id', 64).notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.foreign('payment_method_id', 'fk_rule_method')
      .references('id')
      .inTable('payment_methods')
      .onDelete('CASCADE');

    table.unique(['user_id', 'alias_pattern']);
  });

  // 5. User Preferences & Fetcher Emails
  await knex.schema.createTable('fetcher_emails', (table) => {
    table.increments('id').primary();
    table.string('user_id', 255).notNullable();
    table.string('email', 255).notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.unique(['user_id', 'email']);
  });

  await knex.schema.createTable('user_preferences', (table) => {
    table.string('user_id', 255).primary();
    table.integer('billing_cycle_start_day').notNullable().defaultTo(1);
    table.decimal('expected_salary', 15, 2).notNullable().defaultTo(0.00);
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // 6. Cycle Overrides
  await knex.schema.createTable('cycle_override', (table) => {
    table.string('id', 64).primary();
    table.string('user_id', 255).notNullable();
    table.string('cycle_name', 100).nullable();
    table.string('start_type', 50).notNullable();
    table.string('start_transaction_id', 64).nullable();
    table.date('start_date').notNullable();
    table.timestamp('start_timestamp', { useTz: true }).notNullable();
    table.date('end_date').nullable();
    table.timestamp('end_timestamp', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.index(['user_id', 'start_date'], 'idx_cycle_user_start');
  });

  // 7. Fixed Charges
  await knex.schema.createTable('fixed_charges', (table) => {
    table.string('id', 64).primary();
    table.string('user_id', 255).notNullable();
    table.string('name', 255).notNullable();
    table.bigInteger('amount_cents').notNullable();
    table.string('currency', 10).notNullable();
    table.string('category', 100).notNullable();
    table.date('start_date').notNullable();
    table.date('end_date').notNullable();
    table.string('payment_method', 100).nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // 8. LLM Extraction Logs & Feedback Learning
  await knex.schema.createTable('llm_extraction_logs', (table) => {
    table.string('id', 255).primary();
    table.string('user_id', 255).notNullable();
    table.string('bronze_input_id', 255).notNullable();
    table.string('extracted_merchant', 255).nullable();
    table.bigInteger('extracted_amount_cents').nullable();
    table.string('extracted_currency', 10).nullable();
    table.string('extracted_date', 50).nullable();
    table.string('extracted_category', 100).nullable();
    table.string('extracted_payment_method', 100).nullable();
    table.string('extracted_transaction_type', 50).defaultTo('expense');
    table.decimal('confidence_score', 5, 2).nullable();
    table.timestamp('extracted_at', { useTz: true }).defaultTo(knex.fn.now());
    table.text('raw_email_snippet').nullable();
    table.jsonb('extracted_json').nullable();
    table.string('model_name', 100).nullable();
    table.integer('latency_ms').nullable();

    table.foreign(['user_id', 'bronze_input_id'], 'fk_llm_logs_bronze')
      .references(['user_id', 'id'])
      .inTable('bronze_raw_inputs')
      .onDelete('CASCADE');

    table.unique(['user_id', 'bronze_input_id'], 'uq_llm_logs_bronze');
    table.index(['user_id', 'bronze_input_id'], 'idx_llm_logs_bronze');
  });

  await knex.schema.createTable('feedback_settings', (table) => {
    table.string('user_id', 255).primary();
    table.boolean('is_enabled').notNullable().defaultTo(false);
    table.integer('max_examples').notNullable().defaultTo(10);
    table.decimal('similarity_threshold', 4, 2).defaultTo(0.70);
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('correction_examples', (table) => {
    table.string('id', 64).primary();
    table.string('user_id', 255).notNullable();
    table.string('bronze_input_id', 255).notNullable();
    table.string('field_name', 50).notNullable();
    table.text('llm_value').nullable();
    table.text('corrected_value').notNullable();
    table.text('email_snippet').nullable();
    table.jsonb('embedding').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.unique(['user_id', 'bronze_input_id', 'field_name']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('correction_examples');
  await knex.schema.dropTableIfExists('feedback_settings');
  await knex.schema.dropTableIfExists('llm_extraction_logs');
  await knex.schema.dropTableIfExists('fixed_charges');
  await knex.schema.dropTableIfExists('cycle_override');
  await knex.schema.dropTableIfExists('user_preferences');
  await knex.schema.dropTableIfExists('fetcher_emails');
  await knex.schema.dropTableIfExists('payment_mapping_rules');
  await knex.schema.dropTableIfExists('payment_methods');
  await knex.schema.dropTableIfExists('gold_transactions');
  await knex.schema.dropTableIfExists('silver_extracted_transactions');
  await knex.schema.dropTableIfExists('bronze_raw_inputs');
}
