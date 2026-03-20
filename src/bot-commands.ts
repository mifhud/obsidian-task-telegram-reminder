/**
 * Bot Commands module
 * Handles /status and /upcoming commands from Telegram
 */

import TelegramBot from 'node-telegram-bot-api';
import { addDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type { Config, Task, Reminder } from './types.js';
import { scanVault, filterRelevantTasks } from './scanner.js';
import { calculateDaysUntilDue } from './reminder-engine.js';
import { formatStatusMessage, formatUpcomingMessage } from './notifier.js';
import { getLogger } from './logger.js';

/**
 * Registers bot commands for interactive queries
 */
export function registerBotCommands(
  bot: TelegramBot,
  config: Config
): void {
  const logger = getLogger();

  // /status command - show today's and upcoming tasks
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id.toString();

    // Only respond to the configured chat
    if (chatId !== config.telegramChatId) {
      logger.warn('Ignoring /status from unauthorized chat', { chatId });
      return;
    }

    logger.info('Processing /status command');

    try {
      const result = scanVault(config.vaultPath, config);
      const relevantTasks = filterRelevantTasks(result.tasks, config.includeScheduled);

      const now = new Date();
      const todayTasks: Reminder[] = [];
      const upcomingTasks: Reminder[] = [];

      for (const task of relevantTasks) {
        if (!task.dueDate) continue;

        const daysUntil = calculateDaysUntilDue(task.dueDate, now, config.timezone);

        if (daysUntil === 0) {
          todayTasks.push({
            task,
            reminderType: 'due-today',
            daysUntilDue: daysUntil,
            key: '',
          });
        } else if (daysUntil > 0 && daysUntil <= 7) {
          upcomingTasks.push({
            task,
            reminderType: daysUntil === 1 ? '1-day-before' : '2-days-before',
            daysUntilDue: daysUntil,
            key: '',
          });
        }
      }

      // Sort upcoming by due date
      upcomingTasks.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

      const message = formatStatusMessage(todayTasks, upcomingTasks);
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

      logger.info('Sent /status response', {
        todayCount: todayTasks.length,
        upcomingCount: upcomingTasks.length,
      });
    } catch (error) {
      logger.error('Failed to process /status command', { error });
      await bot.sendMessage(
        chatId,
        '❌ Failed to get task status. Check the logs for details.'
      );
    }
  });

  // /upcoming command - show tasks in next 7 days
  bot.onText(/\/upcoming/, async (msg) => {
    const chatId = msg.chat.id.toString();

    if (chatId !== config.telegramChatId) {
      logger.warn('Ignoring /upcoming from unauthorized chat', { chatId });
      return;
    }

    logger.info('Processing /upcoming command');

    try {
      const result = scanVault(config.vaultPath, config);
      const relevantTasks = filterRelevantTasks(result.tasks, config.includeScheduled);

      const now = new Date();
      const upcomingReminders: Reminder[] = [];

      for (const task of relevantTasks) {
        if (!task.dueDate) continue;

        const daysUntil = calculateDaysUntilDue(task.dueDate, now, config.timezone);

        // Include tasks due in next 7 days (including today)
        if (daysUntil >= 0 && daysUntil <= 7) {
          upcomingReminders.push({
            task,
            reminderType: daysUntil === 0 ? 'due-today' : daysUntil === 1 ? '1-day-before' : '2-days-before',
            daysUntilDue: daysUntil,
            key: '',
          });
        }
      }

      // Sort by due date
      upcomingReminders.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

      const message = formatUpcomingMessage(upcomingReminders);
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

      logger.info('Sent /upcoming response', {
        taskCount: upcomingReminders.length,
      });
    } catch (error) {
      logger.error('Failed to process /upcoming command', { error });
      await bot.sendMessage(
        chatId,
        '❌ Failed to get upcoming tasks. Check the logs for details.'
      );
    }
  });

  // /help command
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id.toString();

    if (chatId !== config.telegramChatId) {
      return;
    }

    const helpText = `
📚 <b>Obsidian Reminder Bot Commands</b>

/status - Show tasks due today and upcoming tasks
/upcoming - Show all tasks due in the next 7 days
/help - Show this help message

<i>Reminders are sent automatically based on your schedule.</i>
    `.trim();

    await bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
  });

  logger.info('Bot commands registered: /status, /upcoming, /help');
}

/**
 * Starts polling for bot commands
 */
export function startPolling(bot: TelegramBot): void {
  const logger = getLogger();
  
  try {
    bot.startPolling({ polling: true });
    logger.info('Bot polling started');
  } catch (error) {
    logger.error('Failed to start bot polling', { error });
  }
}

/**
 * Stops bot polling
 */
export function stopPolling(bot: TelegramBot): void {
  const logger = getLogger();
  
  try {
    bot.stopPolling();
    logger.info('Bot polling stopped');
  } catch (error) {
    logger.error('Failed to stop bot polling', { error });
  }
}
