import { ITransactionRepository } from './transaction-repository';
import { IFeedbackRepository } from './feedback-repository';
import { SQLiteTransactionRepository } from './sqlite-transaction-repository';
import { AzureSqlTransactionRepository } from './azure-sql-transaction-repository';

/**
 * Factory pattern helper to return the active repository instance.
 * - In test environment (process.env.NODE_ENV === 'test'), defaults to SQLiteTransactionRepository
 *   unless process.env.FORCE_AZURE_SQL_TEST is explicitly set.
 * - In production/development runtime (NODE_ENV !== 'test'), when DB_PROVIDER is 'azuresql',
 *   returns AzureSqlTransactionRepository instance.
 * - Otherwise (default/fallback), returns a new instance of SQLiteTransactionRepository (untouched).
 */
export function getRepository(): ITransactionRepository & IFeedbackRepository {
  if (process.env.FORCE_AZURE_SQL_TEST) {
    return AzureSqlTransactionRepository.getInstance();
  }

  if (process.env.DB_PROVIDER === 'azuresql' && process.env.NODE_ENV !== 'test') {
    return AzureSqlTransactionRepository.getInstance();
  }

  return new SQLiteTransactionRepository();
}
