/**
 * Database module
 * Manages MySQL connection pool and table initialization
 */

import { createPool, Pool, PoolOptions } from 'mysql2/promise';
import type { MySqlConfig } from './types.js';
import { getLogger } from './logger.js';

let pool: Pool | null = null;

/**
 * Creates the MySQL connection pool
 */
export function createDatabasePool(config: MySqlConfig): Pool {
  const logger = getLogger();

  const poolOptions: PoolOptions = {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    // Merge additional options from config
    ...config.options,
  };

  logger.debug('Creating MySQL connection pool', {
    host: config.host,
    port: config.port,
    database: config.database,
  });

  pool = createPool(poolOptions);
  return pool;
}

/**
 * Gets the current connection pool
 * @throws Error if pool not initialized
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call createDatabasePool first.');
  }
  return pool;
}

/**
 * Initializes the database schema
 * Creates the sent_reminders table if it doesn't exist
 */
export async function initDatabase(): Promise<void> {
  const logger = getLogger();
  const db = getPool();

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS sent_reminders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reminder_key VARCHAR(512) NOT NULL UNIQUE,
      sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      task_description TEXT NOT NULL,
      due_date DATE NOT NULL,
      reminder_type ENUM('overdue', 'due-now', 'upcoming') NOT NULL,
      file_path VARCHAR(1024) NOT NULL,
      INDEX idx_sent_at (sent_at),
      INDEX idx_due_date (due_date)
    )
  `;

  try {
    await db.execute(createTableSQL);
    logger.info('Database schema initialized');
  } catch (error) {
    logger.error('Failed to initialize database schema', { error });
    throw error;
  }
}

/**
 * Tests the database connection
 * @returns true if connection successful, false otherwise
 */
export async function testConnection(): Promise<boolean> {
  const logger = getLogger();
  try {
    const db = getPool();
    await db.execute('SELECT 1');
    logger.debug('Database connection test successful');
    return true;
  } catch (error) {
    logger.error('Database connection test failed', { error });
    return false;
  }
}

/**
 * Closes the database connection pool
 */
export async function closePool(): Promise<void> {
  const logger = getLogger();
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database connection pool closed');
  }
}
