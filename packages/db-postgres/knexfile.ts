import type { Knex } from 'knex';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from services/postgres/.env or backend/.env or root
dotenv.config({ path: path.resolve(__dirname, '../../services/postgres/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });
dotenv.config();

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: process.env.POSTGRES_DB || 'daily_expense_db',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
    },
    pool: {
      min: 0,
      max: 10,
    },
    migrations: {
      directory: path.resolve(__dirname, './src/migrations'),
      extension: 'ts',
      tableName: 'knex_migrations',
    },
  },
  production: {
    client: 'pg',
    connection: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: process.env.POSTGRES_DB || 'daily_expense_db',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
    },
    pool: {
      min: 0,
      max: 10,
    },
    migrations: {
      directory: path.resolve(__dirname, './dist/migrations'),
      extension: 'js',
      tableName: 'knex_migrations',
    },
  },
  test: {
    client: 'pg',
    connection: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: process.env.POSTGRES_TEST_DB || 'daily_expense_test_db',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      ssl: false,
    },
    pool: {
      min: 0,
      max: 5,
    },
    migrations: {
      directory: path.resolve(__dirname, './src/migrations'),
      extension: 'ts',
      tableName: 'knex_migrations',
    },
  },
};

export default config;
module.exports = config;
