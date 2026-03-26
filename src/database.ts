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

  const createSentRemindersSQL = `
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

  const createVaultTasksSQL = `
    CREATE TABLE IF NOT EXISTS vault_tasks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_path VARCHAR(1024) NOT NULL,
      line_number INT NOT NULL,
      raw_line TEXT NOT NULL,
      description TEXT NOT NULL,
      is_done TINYINT(1) NOT NULL DEFAULT 0,
      due_date DATE NULL,
      scheduled_date DATE NULL,
      start_date DATE NULL,
      created_date DATE NULL,
      end_time VARCHAR(5) NULL,
      priority ENUM('high','medium','low','none') NOT NULL DEFAULT 'none',
      recurrence VARCHAR(255) NULL,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_file_line (file_path(500), line_number),
      INDEX idx_due_date (due_date),
      INDEX idx_scheduled_date (scheduled_date)
    )
  `;

  try {
    await db.execute(createSentRemindersSQL);
    await db.execute(createVaultTasksSQL);
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
