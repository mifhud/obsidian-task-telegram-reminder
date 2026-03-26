/**
 * Obsidian Telegram Reminder - Main Entry Point
 *
 * A standalone Node.js background process that monitors an Obsidian vault
 * for tasks with due dates and sends Telegram reminders.
 */

import { loadConfig, loadConfigSafe } from './config.js';
import { createLogger, setLogger, getLogger } from './logger.js';
import { readTasksFromDb } from './task-reader.js';
import { evaluateReminders, getReminderSummary } from './reminder-engine.js';
import {
  loadSentLog,
  recordSentReminder,
  cleanupSentLog,
  needsCleanup,
  getSentLogStats,
} from './sent-log-mysql.js';
import {
  createDatabasePool,
  getPool,
  initDatabase,
  testConnection,
  closePool,
} from './database.js';
import { createBot, sendReminders, sendStartupMessage } from './notifier.js';
import { createSchedulerFromConfig, describeCron } from './scheduler.js';
import { registerBotCommands, startPolling, stopPolling } from './bot-commands.js';
import type { Config } from './types.js';
import type { Scheduler } from './scheduler.js';
import TelegramBot from 'node-telegram-bot-api';

// Global state
let config: Config;
let bot: TelegramBot;
let scheduler: Scheduler | null = null;
let isShuttingDown = false;

/**
 * Runs a single scan cycle
 */
async function runScanCycle(dryRun: boolean = false): Promise<void> {
  const logger = getLogger();
  const startTime = Date.now();

  logger.info('Starting scan cycle...');

  try {
    // Read tasks from vault_tasks DB table (written by Obsidian plugin)
    const relevantTasks = await readTasksFromDb(getPool(), config.includeScheduled);
    logger.info('Tasks loaded from DB', {
      totalTasks: relevantTasks.length,
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

/**
 * Graceful shutdown handler
 */
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

/**
 * Main function
 */
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

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
