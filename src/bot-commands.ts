/**
 * Bot Commands module
 * Handles /status and /upcoming commands from Telegram
 */

import TelegramBot from 'node-telegram-bot-api';
import { addDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type { Config, Task, Reminder } from './types.js';
import { scanVault, filterRelevantTasks } from './scanner.js';
import { calculateMinutesUntilDue } from './reminder-engine.js';
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

        const minutesUntil = calculateMinutesUntilDue(task.dueDate, task.endTime, now, config.timezone);

        if (minutesUntil <= 0 && minutesUntil > -1440) {
          todayTasks.push({
            task,
            reminderType: 'due-now',
            minutesUntilDue: minutesUntil,
            thresholdMinutes: 0,
            key: '',
          });
        } else if (minutesUntil > 0 && minutesUntil <= 10080) {
          upcomingTasks.push({
            task,
            reminderType: 'upcoming',
            minutesUntilDue: minutesUntil,
            thresholdMinutes: minutesUntil,
            key: '',
          });
        }
      }

      // Sort upcoming by due date
      upcomingTasks.sort((a, b) => a.minutesUntilDue - b.minutesUntilDue);

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

        const minutesUntil = calculateMinutesUntilDue(task.dueDate, task.endTime, now, config.timezone);

        // Include tasks due in next 7 days (including today)
        if (minutesUntil >= 0 && minutesUntil <= 10080) {
          upcomingReminders.push({
            task,
            reminderType: minutesUntil === 0 ? 'due-now' : 'upcoming',
            minutesUntilDue: minutesUntil,
            thresholdMinutes: minutesUntil,
            key: '',
          });
        }
      }

      // Sort by due date
      upcomingReminders.sort((a, b) => a.minutesUntilDue - b.minutesUntilDue);

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
