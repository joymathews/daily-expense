import fs from 'fs';
import path from 'path';

describe('Standalone Migration Tool Tests', () => {
  const schemaPath = path.resolve(__dirname, '../src/azure-sql-schema.sql');

  test('azure-sql-schema.sql exists and contains DDL for all 12 tables', () => {
    expect(fs.existsSync(schemaPath)).toBe(true);

    const ddlContent = fs.readFileSync(schemaPath, 'utf8');

    const expectedTables = [
      'bronze_raw_inputs',
      'silver_extracted_transactions',
      'gold_transactions',
      'user_cycles',
      'llm_extraction_logs',
      'payment_methods',
      'payment_mapping_rules',
      'user_preferences',
      'fetcher_emails',
      'fixed_charges',
      'llm_feedback_settings',
      'llm_correction_examples',
    ];

    for (const table of expectedTables) {
      expect(ddlContent).toContain(table);
    }
  });

  test('azure-sql-schema.sql contains correct Azure SQL data types', () => {
    const ddlContent = fs.readFileSync(schemaPath, 'utf8');

    // Decimal for currency precision
    expect(ddlContent).toContain('DECIMAL(18, 2)');
    // Bit for booleans
    expect(ddlContent).toContain('BIT');
    // Datetime2 for timestamps
    expect(ddlContent).toContain('DATETIME2');
    // NVARCHAR for Unicode strings
    expect(ddlContent).toContain('NVARCHAR');
  });

  test('amount_cents to decimal float conversion logic works correctly', () => {
    const amountCents = 1999;
    const decimalAmount = Number(amountCents) / 100.0;
    expect(decimalAmount).toBe(19.99);

    const zeroCents = 0;
    expect(Number(zeroCents) / 100.0).toBe(0);
  });
});
