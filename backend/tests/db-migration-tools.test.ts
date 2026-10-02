import path from 'path';
import fs from 'fs';
const { exportAzureSqlSnapshot, normalizeRecord } = require('../../tools/export-azure-sql');
const { importPostgresSnapshot, IMPORT_ORDER_TABLES, buildInsertQuery } = require('../../tools/import-postgres');

describe('Database Snapshot Export & Import CLI Tools', () => {
  const testExportsDir = path.resolve(__dirname, '../data/test_exports');

  beforeEach(() => {
    if (fs.existsSync(testExportsDir)) {
      fs.rmSync(testExportsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testExportsDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(testExportsDir)) {
      fs.rmSync(testExportsDir, { recursive: true, force: true });
    }
  });

  describe('Azure SQL Data Snapshot Exporter [FUNC-SYS-10] [NFR-DB-6]', () => {
    /**
     * @description Validates normalizeRecord properly converts Dates, BigInts, and booleans.
     * @testJustification [FUNC-SYS-10, NFR-DB-6] Guarantees consistent JSON serialization of database data types without loss of fidelity.
     */
    it('[FUNC-SYS-10][NFR-DB-6] should normalize dates to ISO strings and BigInt to string', () => {
      const now = new Date('2026-09-15T12:00:00.000Z');
      const sampleRow = {
        id: 'tx_123',
        amount_cents: BigInt(54000),
        transaction_date: now,
        has_transaction: true,
        merchant_raw: 'Amazon IN',
      };

      const normalized = normalizeRecord(sampleRow);
      expect(normalized.id).toBe('tx_123');
      expect(normalized.amount_cents).toBe('54000');
      expect(normalized.transaction_date).toBe('2026-09-15T12:00:00.000Z');
      expect(normalized.has_transaction).toBe(true);
      expect(normalized.merchant_raw).toBe('Amazon IN');
    });

    /**
     * @description Verifies export covers all 12 Medallion tables and produces valid JSON files and manifest.
     * @testJustification [FUNC-SYS-10, NFR-DB-6] Ensures snapshot integrity and creates manifest with table row counts.
     */
    it('[FUNC-SYS-10][NFR-DB-6] should export all 12 tables and produce manifest.json in timestamped directory', async () => {
      // Mock MSSQL pool
      const mockMssql = {
        connect: jest.fn().mockResolvedValue({
          request: jest.fn().mockReturnValue({
            query: jest.fn().mockImplementation((queryStr: string) => {
              if (queryStr.includes('gold_transactions')) {
                return Promise.resolve({
                  recordset: [
                    {
                      id: 'gold_1',
                      user_id: 'user_abc',
                      merchant: 'Starbucks',
                      amount_cents: 450,
                      currency: 'USD',
                      category: 'Restaurant & Dining',
                      transaction_date: new Date('2026-09-10'),
                    },
                  ],
                });
              }
              if (queryStr.includes('bronze_raw_inputs')) {
                return Promise.resolve({
                  recordset: [
                    {
                      id: 'bronze_1',
                      user_id: 'user_abc',
                      source_type: 'email',
                      sender: 'receipts@uber.com',
                      title: 'Your Uber Ride',
                      raw_body: 'Trip receipt',
                      received_at: new Date('2026-09-08'),
                    },
                  ],
                });
              }
              return Promise.resolve({ recordset: [] });
            }),
          }),
          close: jest.fn().mockResolvedValue(undefined),
        }),
      };

      // Mock require for mssql
      jest.mock('mssql', () => mockMssql, { virtual: true });

      const customConfig: any = {
        server: 'test.database.windows.net',
        database: 'daily_expense_test_db',
        user: 'test_sa',
        password: 'mock_password',
      };

      const result = await exportAzureSqlSnapshot(customConfig, testExportsDir);

      expect(result).toBeDefined();
      expect(result.manifest.tables.gold_transactions).toBe(1);
      expect(result.manifest.tables.bronze_raw_inputs).toBe(1);
      expect(result.manifest.totalRows).toBe(2);

      // Verify files created in latest directory
      const latestDir = result.latestDir;
      expect(fs.existsSync(path.join(latestDir, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(latestDir, 'gold_transactions.json'))).toBe(true);
      expect(fs.existsSync(path.join(latestDir, 'bronze_raw_inputs.json'))).toBe(true);

      const goldJson = JSON.parse(fs.readFileSync(path.join(latestDir, 'gold_transactions.json'), 'utf8'));
      expect(goldJson.length).toBe(1);
      expect(goldJson[0].merchant).toBe('Starbucks');
      expect(goldJson[0].id).toBe('gold_1');
    });
  });

  describe('PostgreSQL Data Snapshot Importer [FUNC-SYS-11] [NFR-DB-7]', () => {
    /**
     * @description Tests buildInsertQuery for regular tables and upsert tables.
     * @testJustification [FUNC-SYS-11, NFR-DB-7] Validates conflict-safe SQL statement construction.
     */
    it('[FUNC-SYS-11][NFR-DB-7] should construct conflict-safe SQL queries for table ingestion', () => {
      // 1. Regular table (DO NOTHING)
      const goldRow = {
        id: 'gold_100',
        user_id: 'user_xyz',
        merchant: 'Uber',
        amount_cents: 1200,
      };
      const goldQuery = buildInsertQuery('gold_transactions', goldRow);
      expect(goldQuery).toBeDefined();
      expect(goldQuery?.sql).toContain('INSERT INTO "gold_transactions"');
      expect(goldQuery?.sql).toContain('ON CONFLICT DO NOTHING');
      expect(goldQuery?.values).toEqual(['gold_100', 'user_xyz', 'Uber', 1200]);

      // 2. User preferences table (DO UPDATE SET)
      const prefRow = {
        user_id: 'user_xyz',
        billing_cycle_start_day: 5,
        expected_salary: 8500.0,
      };
      const prefQuery = buildInsertQuery('user_preferences', prefRow);
      expect(prefQuery).toBeDefined();
      expect(prefQuery?.sql).toContain('INSERT INTO "user_preferences"');
      expect(prefQuery?.sql).toContain('ON CONFLICT ("user_id") DO UPDATE SET');
      expect(prefQuery?.sql).toContain('"billing_cycle_start_day" = EXCLUDED."billing_cycle_start_day"');
    });

    /**
     * @description Validates import order complies with Medallion foreign-key dependencies.
     * @testJustification [FUNC-SYS-11, NFR-DB-7] Foreign keys must have parents inserted before children.
     */
    it('[FUNC-SYS-11] should respect foreign key topological ordering in IMPORT_ORDER_TABLES', () => {
      const bronzeIdx = IMPORT_ORDER_TABLES.indexOf('bronze_raw_inputs');
      const silverIdx = IMPORT_ORDER_TABLES.indexOf('silver_extracted_transactions');
      const methodIdx = IMPORT_ORDER_TABLES.indexOf('payment_methods');
      const ruleIdx = IMPORT_ORDER_TABLES.indexOf('payment_mapping_rules');

      expect(bronzeIdx).toBeLessThan(silverIdx);
      expect(methodIdx).toBeLessThan(ruleIdx);
    });

    /**
     * @description Verifies snapshot ingestion against mock PostgreSQL pool and generates reconciliation report.
     * @testJustification [FUNC-SYS-11, NFR-DB-7] Ensures automated reconciliation reporting and row-count verification.
     */
    it('[FUNC-SYS-11][NFR-DB-7] should ingest snapshot files and generate reconciliation report matching manifest', async () => {
      const mockSnapshotDir = path.join(testExportsDir, 'mock-snapshot');
      fs.mkdirSync(mockSnapshotDir, { recursive: true });

      const manifest = {
        exportTimestamp: '2026-09-15T12:00:00.000Z',
        sourceServer: 'azure-sql-prod.database.windows.net',
        sourceDatabase: 'daily_expense_prod',
        tables: {
          bronze_raw_inputs: 1,
          gold_transactions: 1,
          user_preferences: 1,
        },
        totalRows: 3,
      };

      fs.writeFileSync(path.join(mockSnapshotDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      fs.writeFileSync(
        path.join(mockSnapshotDir, 'bronze_raw_inputs.json'),
        JSON.stringify([{ id: 'b1', user_id: 'u1', source_type: 'email', sender: 'test@amazon.com', title: 'Order', raw_body: 'Body', received_at: '2026-09-15' }]),
        'utf8'
      );
      fs.writeFileSync(
        path.join(mockSnapshotDir, 'gold_transactions.json'),
        JSON.stringify([{ id: 'g1', user_id: 'u1', source_type: 'email', merchant: 'Amazon', amount_cents: 2500, currency: 'USD', category: 'Shopping', transaction_date: '2026-09-15' }]),
        'utf8'
      );
      fs.writeFileSync(
        path.join(mockSnapshotDir, 'user_preferences.json'),
        JSON.stringify([{ user_id: 'u1', billing_cycle_start_day: 1, expected_salary: 5000 }]),
        'utf8'
      );

      // Mock PG Client & Pool
      const executedQueries: string[] = [];
      const mockClient = {
        query: jest.fn().mockImplementation((queryStr: string) => {
          executedQueries.push(queryStr);
          if (queryStr.includes('information_schema.columns')) {
            return Promise.resolve({
              rows: [
                { column_name: 'id' },
                { column_name: 'user_id' },
                { column_name: 'source_type' },
                { column_name: 'sender' },
                { column_name: 'title' },
                { column_name: 'raw_body' },
                { column_name: 'received_at' },
                { column_name: 'merchant' },
                { column_name: 'amount_cents' },
                { column_name: 'currency' },
                { column_name: 'category' },
                { column_name: 'transaction_date' },
                { column_name: 'billing_cycle_start_day' },
                { column_name: 'expected_salary' },
              ],
            });
          }
          if (queryStr.includes('SELECT COUNT(*)')) {
            return Promise.resolve({ rows: [{ count: 1 }] });
          }
          return Promise.resolve({ rows: [], rowCount: 1 });
        }),
        release: jest.fn(),
      };

      const mockPool: any = {
        options: { host: 'localhost', port: 5432, database: 'test_db' },
        connect: jest.fn().mockResolvedValue(mockClient),
        end: jest.fn().mockResolvedValue(undefined),
      };

      // Mock pg
      jest.mock('pg', () => ({ Pool: jest.fn(() => mockPool) }), { virtual: true });

      const result = await importPostgresSnapshot({}, mockSnapshotDir);

      expect(result).toBeDefined();
      expect(result.totalImported).toBe(3);
      expect(result.reconciliationReport.length).toBe(12);

      const goldReport = result.reconciliationReport.find((r: any) => r['Table Name'] === 'gold_transactions');
      expect(goldReport).toBeDefined();
      expect(goldReport?.Status).toBe('MATCH');
      expect(goldReport?.['Exported Count']).toBe(1);
      expect(goldReport?.['Inserted In Run']).toBe(1);
    });
  });
});
