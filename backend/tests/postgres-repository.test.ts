import { PostgresTransactionRepository } from '@daily-expense/db-postgres';
import { SQLiteTransactionRepository } from '@daily-expense/db-sqlite';
import { AzureSqlTransactionRepository } from '@daily-expense/db-mssql';
import { getRepository } from '../src/db/transaction-repository-factory';

describe('PostgresTransactionRepository & Factory Tests [FUNC-SYS-7] [FUNC-SYS-8] [NFR-DB-1] [NFR-DB-4]', () => {
  const originalProvider = process.env.DB_PROVIDER;
  const originalForcePostgres = process.env.FORCE_POSTGRES_TEST;
  const originalForceAzure = process.env.FORCE_AZURE_SQL_TEST;

  afterEach(() => {
    if (originalProvider !== undefined) {
      process.env.DB_PROVIDER = originalProvider;
    } else {
      delete process.env.DB_PROVIDER;
    }
    if (originalForcePostgres !== undefined) {
      process.env.FORCE_POSTGRES_TEST = originalForcePostgres;
    } else {
      delete process.env.FORCE_POSTGRES_TEST;
    }
    if (originalForceAzure !== undefined) {
      process.env.FORCE_AZURE_SQL_TEST = originalForceAzure;
    } else {
      delete process.env.FORCE_AZURE_SQL_TEST;
    }
  });

  test('[FUNC-SYS-7] [NFR-DB-1] getRepository returns PostgresTransactionRepository when DB_PROVIDER is postgres and FORCE_POSTGRES_TEST is set', () => {
    process.env.DB_PROVIDER = 'postgres';
    process.env.FORCE_POSTGRES_TEST = 'true';
    const repo1 = getRepository();
    const repo2 = getRepository();

    expect(repo1).toBeInstanceOf(PostgresTransactionRepository);
    expect(repo2).toBeInstanceOf(PostgresTransactionRepository);
    expect(repo1).toBe(repo2); // Singleton
  });

  test('[FUNC-SYS-8] [NFR-DB-4] PostgresTransactionRepository supports singleton reset', () => {
    const instance1 = PostgresTransactionRepository.getInstance();
    PostgresTransactionRepository.resetInstance();
    const instance2 = PostgresTransactionRepository.getInstance();

    expect(instance1).not.toBe(instance2);
  });

  test('[FUNC-SYS-7] [FUNC-SYS-8] getRepository returns SQLiteTransactionRepository when DB_PROVIDER is sqlite in tests', () => {
    delete process.env.FORCE_POSTGRES_TEST;
    delete process.env.FORCE_AZURE_SQL_TEST;
    process.env.DB_PROVIDER = 'sqlite';

    const repo = getRepository();
    expect(repo).toBeInstanceOf(SQLiteTransactionRepository);
  });

  test('[FUNC-SYS-7] [NFR-DB-1] getRepository returns AzureSqlTransactionRepository when FORCE_AZURE_SQL_TEST is set', () => {
    delete process.env.FORCE_POSTGRES_TEST;
    process.env.FORCE_AZURE_SQL_TEST = 'true';
    process.env.DB_PROVIDER = 'mssql';

    const repo = getRepository();
    expect(repo).toBeInstanceOf(AzureSqlTransactionRepository);
  });
});
