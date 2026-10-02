import knex, { Knex } from 'knex';
import path from 'path';

/**
 * Programmatic PostgreSQL migration runner.
 * [FUNC-SYS-9, NFR-DB-5]
 */
export function getKnexInstance(customConfig?: Knex.Config): Knex {
  if (customConfig) {
    return knex(customConfig);
  }

  const knexfile = require('../knexfile');
  const env = process.env.NODE_ENV || 'development';
  const config = knexfile[env] || knexfile.development;
  return knex(config);
}

/**
 * Runs all pending migrations to the latest version.
 */
export async function runPostgresMigrations(customConfig?: Knex.Config): Promise<[number, string[]]> {
  const db = getKnexInstance(customConfig);
  try {
    const result = await db.migrate.latest({
      directory: path.resolve(__dirname, './migrations'),
      extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts',
      tableName: 'knex_migrations',
    });
    return result;
  } finally {
    await db.destroy();
  }
}

/**
 * Rolls back the last applied migration batch.
 */
export async function rollbackPostgresMigrations(customConfig?: Knex.Config): Promise<[number, string[]]> {
  const db = getKnexInstance(customConfig);
  try {
    const result = await db.migrate.rollback({
      directory: path.resolve(__dirname, './migrations'),
      extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts',
      tableName: 'knex_migrations',
    });
    return result;
  } finally {
    await db.destroy();
  }
}

/**
 * Returns migration status (completed and pending list).
 */
export async function getMigrationStatus(customConfig?: Knex.Config): Promise<any> {
  const db = getKnexInstance(customConfig);
  try {
    const status = await db.migrate.status({
      directory: path.resolve(__dirname, './migrations'),
      extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts',
      tableName: 'knex_migrations',
    });
    return status;
  } finally {
    await db.destroy();
  }
}
