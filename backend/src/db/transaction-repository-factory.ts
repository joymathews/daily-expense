import { ITransactionRepository, IFeedbackRepository } from '@daily-expense/db-contracts';

/**
 * Factory pattern helper to return the active repository instance.
 * [FUNC-SYS-7, FUNC-SYS-8, NFR-DB-1, NFR-DB-4]
 * 
 * - When DB_PROVIDER is 'postgres' (or FORCE_POSTGRES_TEST), returns PostgresTransactionRepository.
 * - When DB_PROVIDER is 'azuresql' or 'mssql' (or FORCE_AZURE_SQL_TEST), returns AzureSqlTransactionRepository.
 * - When DB_PROVIDER is 'sqlite' or in test default, returns SQLiteTransactionRepository.
 */
export function getRepository(): ITransactionRepository & IFeedbackRepository {
  const provider = (process.env.DB_PROVIDER || (process.env.NODE_ENV === 'test' ? 'sqlite' : 'postgres')).toLowerCase();

  if (process.env.FORCE_POSTGRES_TEST || provider === 'postgres') {
    const { PostgresTransactionRepository } = require('@daily-expense/db-postgres');
    return PostgresTransactionRepository.getInstance();
  }

  if (process.env.FORCE_AZURE_SQL_TEST || provider === 'azuresql' || provider === 'mssql') {
    const { AzureSqlTransactionRepository } = require('@daily-expense/db-mssql');
    return AzureSqlTransactionRepository.getInstance();
  }

  const { SQLiteTransactionRepository } = require('@daily-expense/db-sqlite');
  return new SQLiteTransactionRepository();
}
