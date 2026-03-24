/**
 * Obsidian Telegram Reminder - Main Entry Point
 *
 * A standalone Node.js background process that monitors an Obsidian vault
 * for tasks with due dates and sends Telegram reminders.
 */

import { loadConfig, loadConfigSafe } from './config.js';
import { createLogger, setLogger, getLogger } from './logger.js';
import { scanVault, filterRelevantTasks } from './scanner.js';
import { evaluateReminders, getReminderSummary } from './reminder-engine.js';
import {
  loadSentLog,
  saveSentLog,
  recordSentReminder,
  cleanupSentLog,
  needsCleanup,
  getSentLogStats,
} from './sent-log.js';
import { createBot, sendReminders, sendStartupMessage } from './notifier.js';
import { createSchedulerFromConfig, describeCron } from './scheduler.js';
import { registerBotCommands, startPolling, stopPolling } from './bot-commands.js';
import type { Config, SentLog } from './types.js';
import type { Scheduler } from './scheduler.js';
import TelegramBot from 'node-telegram-bot-api';

// Global state
let config: Config;
let bot: TelegramBot;
let scheduler: Scheduler | null = null;
let sentLog: SentLog;
let isShuttingDown = false;

/**
 * Runs a single scan cycle
 */
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
        recordSentReminder(sentLog, reminder);
      }
      saveSentLog(config.sentLogPath, sentLog);
      logger.debug('Sent log updated');
    }

    // Cleanup old entries if needed
    if (needsCleanup(sentLog)) {
      const removed = cleanupSentLog(sentLog);
      if (removed > 0) {
        logger.info('Cleaned up old sent log entries', { removed });
        saveSentLog(config.sentLogPath, sentLog);
      }
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

  // Save sent log
  try {
    saveSentLog(config.sentLogPath, sentLog);
    logger.info('Sent log saved');
  } catch (error) {
    logger.error('Failed to save sent log on shutdown', { error });
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
    vaultPath: config.vaultPath,
    timezone: config.timezone,
    dryRun,
  });

  // Load sent log
  sentLog = loadSentLog(config.sentLogPath);
  const logStats = getSentLogStats(sentLog);
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
