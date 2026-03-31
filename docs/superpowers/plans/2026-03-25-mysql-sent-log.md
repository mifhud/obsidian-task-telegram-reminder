# MySQL Sent Log Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JSON file-based sent reminders log with MySQL database backend.

**Architecture:** Use mysql2 with connection pooling for database access. Create a new sent-log-mysql module with the same interface as the current sent-log module, backed by a single `sent_reminders` table. Configuration via environment variables with JSON-formatted options for mysql2-native settings.

**Tech Stack:** TypeScript, mysql2/promise, vitest (mocked tests)

**Spec:** `docs/superpowers/specs/2026-03-25-mysql-sent-log-design.md`

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `src/database.ts` | CREATE | MySQL connection pool management |
| `src/sent-log-mysql.ts` | CREATE | MySQL-backed sent log operations |
| `src/__tests__/sent-log-mysql.test.ts` | CREATE | Unit tests with mocked mysql2 |
| `src/types.ts` | MODIFY | Add MySqlConfig type, keep sentLogPath (for backward compat) |
| `src/config.ts` | MODIFY | Add loadMysqlConfig() function |
| `src/index.ts` | MODIFY | Use MySQL sent-log, init DB on startup |
| `config.json` | MODIFY | Remove sentLogPath line |
| `.env.example` | MODIFY | Add MySQL env vars |
| `docker-compose.yml` | MODIFY | Add MySQL env vars |
| `package.json` | MODIFY | Add mysql2 dependency |

---

## Chunk 1: Dependencies and Types

### Task 1: Add mysql2 dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install mysql2 package**

Run:
```bash
npm install mysql2
```

- [ ] **Step 2: Verify installation**

Run: `npm ls mysql2`
Expected: `mysql2@3.x.x` appears in output

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add mysql2 dependency"
```

---

### Task 2: Add MySQL config types

**Files:**
- Modify: `src/types.ts:119-128`

- [ ] **Step 1: Add MySqlConfig interface**

Add after `EnvConfig` interface (around line 128):

```typescript
/**
 * MySQL database configuration
 */
export interface MySqlConfig {
  /** Database host */
  host: string;
  /** Database port */
  port: number;
  /** Database user */
  user: string;
  /** Database password */
  password: string;
  /** Database name */
  database: string;
  /** Additional mysql2 connection options (parsed from JSON) */
  options?: Record<string, unknown>;
}
```

- [ ] **Step 2: Update EnvConfig to include MySQL**

Modify `EnvConfig` interface to add MySQL config:

```typescript
/**
 * Environment variables configuration
 */
export interface EnvConfig {
  /** Telegram bot token from BotFather */
  telegramBotToken: string;
  /** Target Telegram chat ID */
  telegramChatId: string;
  /** Absolute path to Obsidian vault */
  vaultPath: string;
  /** MySQL database configuration */
  mysql: MySqlConfig;
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: Type errors in config.ts (expected - we'll fix next)

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add MySqlConfig interface"
```

---

## Chunk 2: Database Module

### Task 3: Create database module

**Files:**
- Create: `src/database.ts`

- [ ] **Step 1: Create database.ts with pool management**

```typescript
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
```

- [ ] **Step 2: Verify file compiles**

Run: `npm run typecheck`
Expected: Errors in config.ts (still expected - mysql not loaded yet)

- [ ] **Step 3: Commit**

```bash
git add src/database.ts
git commit -m "feat(database): add MySQL connection pool management"
```

---

## Chunk 3: MySQL Sent Log Implementation

### Task 4: Create sent-log-mysql module

**Files:**
- Create: `src/sent-log-mysql.ts`

- [ ] **Step 1: Create sent-log-mysql.ts**

```typescript
/**
 * MySQL-backed Sent Log module
 * Manages persistence of sent reminders in MySQL to prevent duplicates
 */

import { getPool } from './database.js';
import { createHash } from 'crypto';
import type { SentLog, SentReminderEntry, Reminder, ReminderType } from './types.js';
import { getLogger } from './logger.js';

/**
 * In-memory cache of last cleanup date
 * (No need to persist this - checked once daily)
 */
let lastCleanupDate: string = new Date().toISOString().split('T')[0];

/**
 * Generates a unique key for a reminder
 * Key is based on: file path + line content hash + due date + threshold minutes
 */
export function generateReminderKey(
  filePath: string,
  rawLine: string,
  dueDate: string,
  thresholdMinutes: number
): string {
  const lineHash = createHash('md5')
    .update(rawLine)
    .digest('hex')
    .substring(0, 8);

  const reminderTypeId =
    thresholdMinutes < 0 ? `overdue-${Math.abs(thresholdMinutes)}m` : `${thresholdMinutes}m`;

  return `${filePath}:${lineHash}:${dueDate}:${reminderTypeId}`;
}

/**
 * Checks if a reminder has already been sent
 */
export async function isReminderSent(key: string): Promise<boolean> {
  const db = getPool();
  const [rows] = await db.execute(
    'SELECT 1 FROM sent_reminders WHERE reminder_key = ? LIMIT 1',
    [key]
  );
  return (rows as unknown[]).length > 0;
}

/**
 * Records a sent reminder in the database
 */
export async function recordSentReminder(
  reminder: Reminder,
  sentAt: Date = new Date()
): Promise<void> {
  const logger = getLogger();
  const db = getPool();

  const dueDate = reminder.task.dueDate || reminder.task.scheduledDate;
  if (!dueDate) {
    logger.warn('Cannot record reminder without due date', { key: reminder.key });
    return;
  }

  try {
    await db.execute(
      `INSERT INTO sent_reminders 
       (reminder_key, sent_at, task_description, due_date, reminder_type, file_path)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE sent_at = sent_at`,
      [
        reminder.key,
        sentAt.toISOString().slice(0, 19).replace('T', ' '),
        reminder.task.description,
        dueDate,
        reminder.reminderType,
        reminder.task.filePath,
      ]
    );
  } catch (error) {
    logger.error('Failed to record sent reminder', { key: reminder.key, error });
    throw error;
  }
}

/**
 * Cleans up old entries from the database
 * Removes entries older than the specified number of days
 */
export async function cleanupSentLog(maxAgeDays: number = 30): Promise<number> {
  const logger = getLogger();
  const db = getPool();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
  const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');

  try {
    const [result] = await db.execute(
      'DELETE FROM sent_reminders WHERE sent_at < ?',
      [cutoffStr]
    );
    const affectedRows = (result as { affectedRows: number }).affectedRows;
    
    lastCleanupDate = new Date().toISOString().split('T')[0];
    
    if (affectedRows > 0) {
      logger.info('Cleaned up old sent log entries', { removed: affectedRows });
    }
    
    return affectedRows;
  } catch (error) {
    logger.error('Failed to cleanup sent log', { error });
    throw error;
  }
}

/**
 * Checks if cleanup is needed (once per day)
 */
export function needsCleanup(): boolean {
  const today = new Date().toISOString().split('T')[0];
  return lastCleanupDate !== today;
}

/**
 * Gets statistics about the sent log
 */
export async function getSentLogStats(): Promise<{
  totalEntries: number;
  oldestEntry: string | null;
  newestEntry: string | null;
}> {
  const db = getPool();

  const [countResult] = await db.execute('SELECT COUNT(*) as count FROM sent_reminders');
  const count = (countResult as { count: number }[])[0].count;

  if (count === 0) {
    return {
      totalEntries: 0,
      oldestEntry: null,
      newestEntry: null,
    };
  }

  const [minResult] = await db.execute('SELECT MIN(sent_at) as oldest FROM sent_reminders');
  const [maxResult] = await db.execute('SELECT MAX(sent_at) as newest FROM sent_reminders');

  const oldest = (minResult as { oldest: Date }[])[0].oldest;
  const newest = (maxResult as { newest: Date }[])[0].newest;

  return {
    totalEntries: count,
    oldestEntry: oldest ? new Date(oldest).toISOString() : null,
    newestEntry: newest ? new Date(newest).toISOString() : null,
  };
}

/**
 * Loads sent log from database into memory structure (for compatibility)
 * Note: This is mainly for getSentLogStats, actual checks use isReminderSent
 */
export async function loadSentLog(): Promise<SentLog> {
  const db = getPool();

  const [rows] = await db.execute(
    'SELECT reminder_key, sent_at, task_description, due_date, reminder_type, file_path FROM sent_reminders'
  );

  const reminders: Record<string, SentReminderEntry> = {};
  for (const row of rows as Array<{
    reminder_key: string;
    sent_at: Date;
    task_description: string;
    due_date: Date;
    reminder_type: ReminderType;
    file_path: string;
  }>) {
    reminders[row.reminder_key] = {
      sentAt: new Date(row.sent_at).toISOString(),
      task: row.task_description,
      dueDate: new Date(row.due_date).toISOString().split('T')[0],
      reminderType: row.reminder_type,
      filePath: row.file_path,
    };
  }

  return {
    reminders,
    lastCleanup: lastCleanupDate,
  };
}
```

- [ ] **Step 2: Verify file compiles**

Run: `npm run typecheck`
Expected: May have errors in index.ts (expected - we'll update it later)

- [ ] **Step 3: Commit**

```bash
git add src/sent-log-mysql.ts
git commit -m "feat(sent-log-mysql): add MySQL-backed sent log implementation"
```

---

## Chunk 4: Configuration Updates

### Task 5: Update config.ts to load MySQL config

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add MySQL config loading function**

Add after the imports (around line 10):

```typescript
import type { Config, AppConfig, EnvConfig, MySqlConfig } from './types.js';
```

Then add the MySQL config loader function before `loadEnvConfig`:

```typescript
/**
 * Loads MySQL configuration from environment variables
 */
function loadMysqlConfig(): MySqlConfig {
  const host = process.env.MYSQL_HOST;
  const port = process.env.MYSQL_PORT;
  const user = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE;

  if (!host || !user || !password || !database) {
    throw new Error(
      'Missing required MySQL environment variables. Required: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE'
    );
  }

  let options: Record<string, unknown> = {};
  if (process.env.MYSQL_OPTIONS) {
    try {
      options = JSON.parse(process.env.MYSQL_OPTIONS);
    } catch (error) {
      throw new Error(`Invalid MYSQL_OPTIONS JSON: ${error}`);
    }
  }

  return {
    host,
    port: parseInt(port || '3306', 10),
    user,
    password,
    database,
    options,
  };
}
```

- [ ] **Step 2: Update loadEnvConfig to include MySQL**

Modify the `loadEnvConfig` function to include MySQL config:

```typescript
function loadEnvConfig(): EnvConfig {
  // Load .env file
  dotenvConfig();

  const telegramBotToken = requireEnv('TELEGRAM_BOT_TOKEN');
  const telegramChatId = requireEnv('TELEGRAM_CHAT_ID');
  const vaultPath = requireEnv('VAULT_PATH');

  // Resolve vault path to absolute
  const resolvedVaultPath = resolve(vaultPath);

  // Validate vault path exists
  validatePath(resolvedVaultPath, 'Vault path');

  // Load MySQL config
  const mysql = loadMysqlConfig();

  return {
    telegramBotToken,
    telegramChatId,
    vaultPath: resolvedVaultPath,
    mysql,
  };
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: Errors in index.ts related to sentLog (expected - we update next)

- [ ] **Step 4: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add MySQL configuration loading"
```

---

### Task 6: Update config.json

**Files:**
- Modify: `config.json`

- [ ] **Step 1: Remove sentLogPath from config.json**

Remove line 8: `"sentLogPath": "./sent-reminders.json",`

The file should become:

```json
{
  "scanCron": "*/3 * * * *",
  "reminderMinutes": [1440, 60, 15, 0],
  "overdueMinutes": [4320, 1440],
  "excludeFolders": [".obsidian", ".trash", "templates", "archive", "archives"],
  "includeScheduled": true,
  "dataviewFormat": true,
  "timezone": "Asia/Jakarta",
  "logLevel": "info"
}
```

- [ ] **Step 2: Commit**

```bash
git add config.json
git commit -m "chore(config): remove sentLogPath (now using MySQL)"
```

---

### Task 7: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add MySQL env vars**

Add at the end of the file:

```env

# MySQL Database Configuration
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=reminder_user
MYSQL_PASSWORD=your_secure_password
MYSQL_DATABASE=obsidian_reminder

# MySQL Connection Options (JSON format, optional)
# Common options: ssl, connectTimeout, timezone
# Example: {"ssl":false,"connectTimeout":10000}
MYSQL_OPTIONS={"ssl":false}
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add MySQL environment variables to .env.example"
```

---

### Task 8: Update docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add MySQL env vars to service**

Update the environment section:

```yaml
version: '3.8'

services:
  obsidian-reminder:
    build: .
    container_name: obsidian-task-telegram-reminder
    restart: unless-stopped
    
    environment:
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
      - VAULT_PATH=/vault
      - MYSQL_HOST=${MYSQL_HOST}
      - MYSQL_PORT=${MYSQL_PORT:-3306}
      - MYSQL_USER=${MYSQL_USER}
      - MYSQL_PASSWORD=${MYSQL_PASSWORD}
      - MYSQL_DATABASE=${MYSQL_DATABASE}
      - MYSQL_OPTIONS=${MYSQL_OPTIONS:-{}}
    
    volumes:
      # Mount your Obsidian vault (read-only)
      - ${VAULT_PATH}:/vault:ro
      # Optional: custom config
      - ./config.json:/app/config.json:ro

# Example usage:
# 1. Create .env file with TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, VAULT_PATH, and MySQL vars
# 2. Run: docker-compose up -d
# 3. View logs: docker-compose logs -f
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "chore(docker): add MySQL environment variables"
```

---

## Chunk 5: Main Entry Point Updates

### Task 9: Update index.ts to use MySQL

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update imports**

Replace the sent-log imports and add database imports:

```typescript
import { loadConfig, loadConfigSafe } from './config.js';
import { createLogger, setLogger, getLogger } from './logger.js';
import { scanVault, filterRelevantTasks } from './scanner.js';
import { evaluateReminders, getReminderSummary } from './reminder-engine.js';
import {
  isReminderSent,
  recordSentReminder,
  cleanupSentLog,
  needsCleanup,
  getSentLogStats,
  loadSentLog,
} from './sent-log-mysql.js';
import {
  createDatabasePool,
  initDatabase,
  testConnection,
  closePool,
} from './database.js';
import { createBot, sendReminders, sendStartupMessage } from './notifier.js';
import { createSchedulerFromConfig, describeCron } from './scheduler.js';
import { registerBotCommands, startPolling, stopPolling } from './bot-commands.js';
import type { Config, SentLog } from './types.js';
import type { Scheduler } from './scheduler.js';
import TelegramBot from 'node-telegram-bot-api';
```

- [ ] **Step 2: Update runScanCycle function**

Replace the reminder recording and cleanup section:

```typescript
async function runScanCycle(dryRun: boolean = false): Promise<void> {
  const logger = getLogger();
  const startTime = Date.now();

  logger.info('Starting scan cycle...');

  try {
    // Scan vault for tasks
    const scanResult = scanVault(config.vaultPath, config);
    logger.info('Vault scanned', {
      filesScanned: scanResult.filesScanned,
      filesSkipped: scanResult.filesSkipped,
      totalTasks: scanResult.tasks.length,
      durationMs: scanResult.scanDurationMs,
    });

    // Filter to relevant tasks
    const relevantTasks = filterRelevantTasks(
      scanResult.tasks,
      config.includeScheduled
    );
    logger.debug('Filtered relevant tasks', {
      relevant: relevantTasks.length,
      withDueDate: relevantTasks.filter((t) => t.dueDate).length,
    });

    // Load current sent log for evaluation
    const sentLog = await loadSentLog();

    // Evaluate which reminders to send
    const reminders = evaluateReminders(
      relevantTasks,
      new Date(),
      config,
      sentLog
    );

    const summary = getReminderSummary(reminders);
    logger.info('Reminders evaluated', summary);

    if (reminders.length === 0) {
      logger.info('No reminders to send');
      return;
    }

    // Send reminders
    const sendResult = await sendReminders(
      bot,
      config.telegramChatId,
      reminders,
      dryRun
    );

    logger.info('Reminders sent', {
      sent: sendResult.sent,
      failed: sendResult.failed,
    });

    if (sendResult.errors.length > 0) {
      logger.error('Send errors', { errors: sendResult.errors });
    }

    // Record sent reminders (unless dry run)
    if (!dryRun) {
      for (const reminder of reminders) {
        await recordSentReminder(reminder);
      }
      logger.debug('Sent log updated');
    }

    // Cleanup old entries if needed
    if (needsCleanup()) {
      await cleanupSentLog();
    }

    const totalDuration = Date.now() - startTime;
    logger.info('Scan cycle completed', { durationMs: totalDuration });
  } catch (error) {
    logger.error('Scan cycle failed', { error });
  }
}
```

- [ ] **Step 3: Update shutdown function**

Replace the shutdown function:

```typescript
async function shutdown(signal: string): Promise<void> {
  const logger = getLogger();

  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info(`Received ${signal}, shutting down gracefully...`);

  // Stop scheduler
  if (scheduler) {
    scheduler.stop();
    logger.info('Scheduler stopped');
  }

  // Stop bot polling
  if (bot) {
    stopPolling(bot);
  }

  // Close database pool
  try {
    await closePool();
  } catch (error) {
    logger.error('Failed to close database pool on shutdown', { error });
  }

  logger.info('Shutdown complete');
  process.exit(0);
}
```

- [ ] **Step 4: Update main function**

Replace the main function:

```typescript
async function main(): Promise<void> {
  // Check for dry-run flag
  const dryRun = process.argv.includes('--dry-run');

  // Load configuration
  try {
    config = loadConfig();
  } catch (error) {
    console.error('Failed to load configuration:', error);
    process.exit(1);
  }

  // Set up logger
  const logger = createLogger(config.logLevel);
  setLogger(logger);

  logger.info('Obsidian Telegram Reminder starting...', {
    vaultPath: config.vaultPath,
    timezone: config.timezone,
    dryRun,
  });

  // Initialize database
  logger.info('Connecting to MySQL database...');
  try {
    createDatabasePool(config.mysql);
    const connected = await testConnection();
    if (!connected) {
      logger.error('Failed to connect to MySQL database');
      process.exit(1);
    }
    await initDatabase();
    logger.info('Database connection established');
  } catch (error) {
    logger.error('Database initialization failed', { error });
    process.exit(1);
  }

  // Get sent log stats
  const logStats = await getSentLogStats();
  logger.info('Sent log loaded', logStats);

  // Create Telegram bot
  bot = createBot(config.telegramBotToken);

  // Test connection with startup message (unless dry run)
  if (!dryRun) {
    logger.info('Testing Telegram connection...');
    const connected = await sendStartupMessage(bot, config.telegramChatId);
    if (!connected) {
      logger.error('Failed to connect to Telegram. Check your bot token and chat ID.');
      process.exit(1);
    }
    logger.info('Telegram connection successful');

    // Register bot commands and start polling
    registerBotCommands(bot, config);
    startPolling(bot);
  }

  // Set up signal handlers for graceful shutdown
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Run initial scan
  logger.info('Running initial scan...');
  await runScanCycle(dryRun);

  if (dryRun) {
    logger.info('Dry run complete, exiting');
    await closePool();
    process.exit(0);
  }

  // Set up scheduled scans
  scheduler = createSchedulerFromConfig(config, () => runScanCycle(false));

  logger.info('Scheduler started', {
    primarySchedule: describeCron(config.scanCron),
  });

  logger.info('Obsidian Telegram Reminder is running. Press Ctrl+C to stop.');
}
```

- [ ] **Step 5: Remove unused sentLog variable**

Remove the global `sentLog` variable declaration (around line 31):
```typescript
// REMOVE: let sentLog: SentLog;
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: Should pass (or only unrelated errors)

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): switch to MySQL-backed sent log"
```

---

## Chunk 6: Unit Tests

### Task 10: Create MySQL sent-log tests with mocked mysql2

**Files:**
- Create: `src/__tests__/sent-log-mysql.test.ts`

- [ ] **Step 1: Create test file with mocked mysql2**

```typescript
/**
 * Unit tests for the MySQL sent-log module
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Reminder, Task } from '../types.js';

// Mock mysql2/promise before importing modules that use it
const mockExecute = vi.fn();
const mockEnd = vi.fn();

vi.mock('mysql2/promise', () => ({
  createPool: vi.fn(() => ({
    execute: mockExecute,
    end: mockEnd,
  })),
}));

// Mock logger
vi.mock('../logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocks are set up
import {
  generateReminderKey,
  isReminderSent,
  recordSentReminder,
  cleanupSentLog,
  needsCleanup,
  getSentLogStats,
} from '../sent-log-mysql.js';
import { createDatabasePool } from '../database.js';

const createMockReminder = (overrides: Partial<Reminder> = {}): Reminder => ({
  task: {
    description: 'Test task',
    dueDate: '2026-04-15',
    scheduledDate: null,
    startDate: null,
    createdDate: null,
    endTime: null,
    isDone: false,
    priority: 'none',
    filePath: 'test.md',
    lineNumber: 1,
    rawLine: '- [ ] Test task 📅 2026-04-15',
    recurrence: null,
  },
  reminderType: 'due-now',
  reminderSource: 'due',
  minutesUntilDue: 0,
  thresholdMinutes: 0,
  key: 'test-key-123',
  ...overrides,
});

describe('sent-log-mysql', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Initialize database pool (with mock)
    createDatabasePool({
      host: 'localhost',
      port: 3306,
      user: 'test',
      password: 'test',
      database: 'test',
    });
  });

  describe('generateReminderKey', () => {
    it('should generate consistent keys', () => {
      const key1 = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', 0);
      const key2 = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', 0);

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different thresholds', () => {
      const key1 = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', 0);
      const key2 = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', 60);

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different tasks', () => {
      const key1 = generateReminderKey('test.md', '- [ ] Task 1', '2026-04-15', 0);
      const key2 = generateReminderKey('test.md', '- [ ] Task 2', '2026-04-15', 0);

      expect(key1).not.toBe(key2);
    });

    it('should include overdue indicator for negative thresholds', () => {
      const key = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', -1440);

      expect(key).toContain('overdue-1440m');
    });
  });

  describe('isReminderSent', () => {
    it('should return false when reminder not found', async () => {
      mockExecute.mockResolvedValueOnce([[]]);

      const result = await isReminderSent('new-key');

      expect(result).toBe(false);
      expect(mockExecute).toHaveBeenCalledWith(
        'SELECT 1 FROM sent_reminders WHERE reminder_key = ? LIMIT 1',
        ['new-key']
      );
    });

    it('should return true when reminder exists', async () => {
      mockExecute.mockResolvedValueOnce([[{ 1: 1 }]]);

      const result = await isReminderSent('existing-key');

      expect(result).toBe(true);
    });
  });

  describe('recordSentReminder', () => {
    it('should insert reminder into database', async () => {
      mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const reminder = createMockReminder();

      await recordSentReminder(reminder);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sent_reminders'),
        expect.arrayContaining([reminder.key, reminder.task.description])
      );
    });
  });

  describe('cleanupSentLog', () => {
    it('should delete old entries', async () => {
      mockExecute.mockResolvedValueOnce([{ affectedRows: 5 }]);

      const removed = await cleanupSentLog(30);

      expect(removed).toBe(5);
      expect(mockExecute).toHaveBeenCalledWith(
        'DELETE FROM sent_reminders WHERE sent_at < ?',
        expect.any(Array)
      );
    });
  });

  describe('needsCleanup', () => {
    it('should return boolean', () => {
      const result = needsCleanup();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getSentLogStats', () => {
    it('should return correct stats for empty database', async () => {
      mockExecute.mockResolvedValueOnce([[{ count: 0 }]]);

      const stats = await getSentLogStats();

      expect(stats.totalEntries).toBe(0);
      expect(stats.oldestEntry).toBeNull();
      expect(stats.newestEntry).toBeNull();
    });

    it('should return correct stats for populated database', async () => {
      mockExecute
        .mockResolvedValueOnce([[{ count: 5 }]])
        .mockResolvedValueOnce([[{ oldest: new Date('2026-04-14T10:00:00Z') }]])
        .mockResolvedValueOnce([[{ newest: new Date('2026-04-15T10:00:00Z') }]]);

      const stats = await getSentLogStats();

      expect(stats.totalEntries).toBe(5);
      expect(stats.oldestEntry).toContain('2026-04-14');
      expect(stats.newestEntry).toContain('2026-04-15');
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test:run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/sent-log-mysql.test.ts
git commit -m "test: add MySQL sent-log unit tests with mocked mysql2"
```

---

## Chunk 7: Update types.ts to remove sentLogPath

### Task 11: Clean up AppConfig type

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Remove sentLogPath from AppConfig**

Find the `AppConfig` interface and remove the `sentLogPath` property:

```typescript
/**
 * Application configuration from config.json
 */
export interface AppConfig {
  /** Cron expression for main scan schedule */
  scanCron: string;
  /** Minutes before due datetime to send reminders (threshold-based) */
  reminderMinutes: number[];
  /** Minutes after due datetime to send overdue reminders (threshold-based, sorted descending) */
  overdueMinutes: number[];
  /** Folders to exclude from scanning */
  excludeFolders: string[];
  /** Whether to also remind on scheduled dates */
  includeScheduled: boolean;
  /** Whether to parse Dataview format [due:: YYYY-MM-DD] */
  dataviewFormat: boolean;
  /** IANA timezone string */
  timezone: string;
  /** Logging level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
```

- [ ] **Step 2: Update DEFAULT_CONFIG in config.ts**

Remove `sentLogPath` from DEFAULT_CONFIG:

```typescript
const DEFAULT_CONFIG: AppConfig = {
  scanCron: '0 8 * * *',
  reminderMinutes: [1440, 60, 15, 0],
  overdueMinutes: [4320, 1440],
  excludeFolders: ['.obsidian', '.trash', 'templates', 'archive', 'archives'],
  includeScheduled: false,
  dataviewFormat: false,
  timezone: 'Asia/Jakarta',
  logLevel: 'info',
};
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: Pass

- [ ] **Step 4: Run all tests**

Run: `npm run test:run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/config.ts
git commit -m "refactor(types): remove sentLogPath from AppConfig"
```

---

## Chunk 8: Final Verification

### Task 12: Build and verify

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 2: Run all tests**

Run: `npm run test:run`
Expected: All tests pass

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No type errors

- [ ] **Step 4: Create final commit**

```bash
git add -A
git commit -m "feat: complete MySQL sent-log migration" --allow-empty
```

---

## Summary

After completing all tasks:

1. **Dependencies:** mysql2 added
2. **New files:** `src/database.ts`, `src/sent-log-mysql.ts`, `src/__tests__/sent-log-mysql.test.ts`
3. **Modified files:** `src/types.ts`, `src/config.ts`, `src/index.ts`, `config.json`, `.env.example`, `docker-compose.yml`
4. **Removed:** `sentLogPath` from config
5. **Legacy files kept:** `src/sent-log.ts`, `src/__tests__/sent-log.test.ts` (can be deleted later)

The application now uses MySQL for sent reminder persistence instead of JSON file.
