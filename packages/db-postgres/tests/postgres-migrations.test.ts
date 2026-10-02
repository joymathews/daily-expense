import knexConfig from '../knexfile';
import { getKnexInstance, runPostgresMigrations, rollbackPostgresMigrations, getMigrationStatus } from '../src/migrator';
import * as initialMigration from '../src/migrations/20260910000001_initial_medallion_schema';
import fs from 'fs';
import path from 'path';

describe('PostgreSQL Database Migrations & Tooling', () => {
  /**
   * @description Validates Knexfile configuration across development, production, and test environments.
   * @testJustification [FUNC-SYS-9, NFR-DB-5] Ensures repeatable, environment-aware configuration for automated migration runs.
   */
  it('[FUNC-SYS-9][NFR-DB-5] should contain valid Knex configuration for development, production, and test environments', () => {
    expect(knexConfig).toBeDefined();
    expect(knexConfig.development).toBeDefined();
    expect(knexConfig.production).toBeDefined();
    expect(knexConfig.test).toBeDefined();

    expect(knexConfig.development.client).toBe('pg');
    expect(knexConfig.production.client).toBe('pg');
    expect(knexConfig.test.client).toBe('pg');

    expect(knexConfig.development.migrations?.tableName).toBe('knex_migrations');
    expect(knexConfig.production.migrations?.tableName).toBe('knex_migrations');
    expect(knexConfig.test.migrations?.tableName).toBe('knex_migrations');
  });

  /**
   * @description Verifies initial medallion baseline migration file exists and exports up/down functions.
   * @testJustification [FUNC-SYS-9] Zero-drift baseline schema file must exist with both rollback and rollforward capabilities.
   */
  it('[FUNC-SYS-9] should provide initial medallion baseline migration exporting up and down methods', () => {
    const migrationsDir = path.resolve(__dirname, '../src/migrations');
    const files = fs.readdirSync(migrationsDir);
    expect(files.length).toBeGreaterThanOrEqual(1);

    const baselineFile = files.find(f => f.includes('initial_medallion_schema'));
    expect(baselineFile).toBeDefined();

    expect(typeof initialMigration.up).toBe('function');
    expect(typeof initialMigration.down).toBe('function');
  });

  /**
   * @description Validates that the baseline migration creates all 12 Medallion tables and drops them on rollback.
   * @testJustification [FUNC-SYS-9, NFR-DB-5] Validates complete Medallion schema coverage for PostgreSQL.
   */
  it('[FUNC-SYS-9][NFR-DB-5] should define DDL creation for all 12 tables in up() and drop them in down()', async () => {
    const createdTables: string[] = [];
    const droppedTables: string[] = [];

    const mockKnex: any = {
      fn: {
        now: jest.fn().mockReturnValue('NOW()'),
      },
      schema: {
        hasTable: jest.fn().mockResolvedValue(false),
        createTable: jest.fn().mockImplementation((tableName: string, callback: Function) => {
          createdTables.push(tableName);
          const mockTable: any = new Proxy({}, {
            get: () => jest.fn().mockReturnValue(mockTable),
          });
          callback(mockTable);
          return Promise.resolve();
        }),
        dropTableIfExists: jest.fn().mockImplementation((tableName: string) => {
          droppedTables.push(tableName);
          return Promise.resolve();
        }),
      },
      raw: jest.fn().mockResolvedValue({}),
    };

    // Execute UP
    await initialMigration.up(mockKnex);

    const expectedTables = [
      'bronze_raw_inputs',
      'silver_extracted_transactions',
      'gold_transactions',
      'payment_methods',
      'payment_mapping_rules',
      'fetcher_emails',
      'user_preferences',
      'cycle_override',
      'fixed_charges',
      'llm_extraction_logs',
      'feedback_settings',
      'correction_examples',
    ];

    expectedTables.forEach(table => {
      expect(createdTables).toContain(table);
    });
    expect(createdTables.length).toBe(12);

    // Execute DOWN
    await initialMigration.down(mockKnex);

    expectedTables.forEach(table => {
      expect(droppedTables).toContain(table);
    });
    expect(droppedTables.length).toBe(12);
  });

  /**
   * @description Tests migrator programmatic API functions.
   * @testJustification [FUNC-SYS-9] Validates programmatic API surface for running migrations.
   */
  it('[FUNC-SYS-9] should provide getKnexInstance and migration runner functions', () => {
    expect(typeof getKnexInstance).toBe('function');
    expect(typeof runPostgresMigrations).toBe('function');
    expect(typeof rollbackPostgresMigrations).toBe('function');
    expect(typeof getMigrationStatus).toBe('function');

    const customKnex = getKnexInstance({
      client: 'pg',
      connection: { host: 'localhost', database: 'test' },
    });
    expect(customKnex).toBeDefined();
    customKnex.destroy();
  });
});
