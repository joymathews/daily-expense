import { AzureSqlTransactionRepository } from '../src/db/azure-sql-transaction-repository';
import { SQLiteTransactionRepository } from '../src/db/sqlite-transaction-repository';
import { getRepository } from '../src/db/transaction-repository-factory';

describe('AzureSqlTransactionRepository and Factory Tests [FUNC-SYS-7, NFR-DB-1]', () => {
  const originalProvider = process.env.DB_PROVIDER;
  const originalForce = process.env.FORCE_AZURE_SQL_TEST;

  afterEach(() => {
    if (originalProvider !== undefined) {
      process.env.DB_PROVIDER = originalProvider;
    } else {
      delete process.env.DB_PROVIDER;
    }
    if (originalForce !== undefined) {
      process.env.FORCE_AZURE_SQL_TEST = originalForce;
    } else {
      delete process.env.FORCE_AZURE_SQL_TEST;
    }
  });

  test('getRepository returns SQLiteTransactionRepository when DB_PROVIDER is sqlite or unset', () => {
    delete process.env.DB_PROVIDER;
    delete process.env.FORCE_AZURE_SQL_TEST;
    const repoDefault = getRepository();
    expect(repoDefault).toBeInstanceOf(SQLiteTransactionRepository);

    process.env.DB_PROVIDER = 'sqlite';
    const repoSqlite = getRepository();
    expect(repoSqlite).toBeInstanceOf(SQLiteTransactionRepository);
  });

  test('getRepository returns AzureSqlTransactionRepository singleton when DB_PROVIDER is azuresql and FORCE_AZURE_SQL_TEST is set', () => {
    process.env.DB_PROVIDER = 'azuresql';
    process.env.FORCE_AZURE_SQL_TEST = 'true';
    const repo1 = getRepository();
    const repo2 = getRepository();

    expect(repo1).toBeInstanceOf(AzureSqlTransactionRepository);
    expect(repo2).toBeInstanceOf(AzureSqlTransactionRepository);
    expect(repo1).toBe(repo2); // Singleton instance
  });

  test('AzureSqlTransactionRepository supports singleton reset', () => {
    const instance1 = AzureSqlTransactionRepository.getInstance();
    AzureSqlTransactionRepository.resetInstance();
    const instance2 = AzureSqlTransactionRepository.getInstance();

    expect(instance1).not.toBe(instance2);
  });
});
