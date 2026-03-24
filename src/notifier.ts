/**
 * Telegram Notifier module
 * Formats and sends reminder messages via Telegram Bot API
 */

import TelegramBot from 'node-telegram-bot-api';
import { format, parseISO } from 'date-fns';
import type { Reminder, SendResult, Priority, ReminderType, ReminderSource } from './types.js';
import { groupRemindersByType, formatMinutesDuration } from './reminder-engine.js';

/**
 * Priority emoji mapping for display
 */
const PRIORITY_DISPLAY: Record<Priority, string> = {
  high: '🔴 High',
  medium: '🟡 Medium',
  low: '🟢 Low',
  none: '',
};

/**
 * Returns a reminder header based on type, threshold minutes, and source
 */
function getReminderHeader(
  reminderType: ReminderType,
  thresholdMinutes: number,
  reminderSource: ReminderSource = 'due'
): string {
  if (reminderType === 'overdue') return '🚨 <b>OVERDUE</b>';
  
  const duration = formatMinutesDuration(thresholdMinutes);
  
  if (reminderSource === 'scheduled') {
    if (reminderType === 'due-now') return '⏰ <b>SCHEDULED NOW</b>';
    return `🔔 <b>Reminder: scheduled in ${duration}</b>`;
  }
  
  if (reminderType === 'due-now') return '⏰ <b>DUE NOW</b>';
  return `🔔 <b>Reminder: due in ${duration}</b>`;
}

/**
 * Formats a date for display
 */
function formatDate(dateStr: string): string {
  try {
    const date = parseISO(dateStr);
    return format(date, 'yyyy-MM-dd (EEEE)');
  } catch {
    return dateStr;
  }
}

/**
 * Escapes HTML special characters for Telegram HTML mode
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Formats a single reminder as an HTML message
 */
export function formatSingleReminder(reminder: Reminder): string {
  const { task, reminderType, reminderSource, minutesUntilDue, thresholdMinutes } = reminder;
  const header = getReminderHeader(reminderType, thresholdMinutes, reminderSource);

  const lines: string[] = [header, ''];

  // Task description
  lines.push(`📝 ${escapeHtml(task.description)}`);

  // Show date based on reminder source
  if (reminderSource === 'scheduled' && task.scheduledDate) {
    const timeStr = task.endTime ? ` ${task.endTime}` : '';
    lines.push(`📅 Scheduled: ${formatDate(task.scheduledDate)}${timeStr}`);
  } else if (task.dueDate) {
    const timeStr = task.endTime ? ` ${task.endTime}` : '';
    lines.push(`📅 Due: ${formatDate(task.dueDate)}${timeStr}`);
  }

  // Overdue indicator
  if (minutesUntilDue < 0) {
    const duration = formatMinutesDuration(minutesUntilDue);
    lines.push(`⚠️ <i>${duration} overdue</i>`);
  }

  // Priority (only if set)
  if (task.priority !== 'none') {
    lines.push(`${PRIORITY_DISPLAY[task.priority]}`);
  }

  // File path
  lines.push(`📂 <code>${escapeHtml(task.filePath)}</code>`);

  return lines.join('\n');
}

/**
 * Formats multiple reminders of the same type as a digest message
 */
export function formatDigestMessage(
  reminders: Reminder[],
  reminderType: ReminderType
): string {
  if (reminders.length === 0) {
    return '';
  }

  if (reminders.length === 1) {
    return formatSingleReminder(reminders[0]);
  }

  // Use the first reminder's source for the header
  const reminderSource = reminders[0].reminderSource;
  const header = getReminderHeader(reminderType, reminders[0].thresholdMinutes, reminderSource);
  
  // Get the relevant date based on source
  const relevantDate = reminderSource === 'scheduled' 
    ? reminders[0].task.scheduledDate 
    : reminders[0].task.dueDate;
  const formattedDate = relevantDate ? formatDate(relevantDate) : '';

  const lines: string[] = [
    `${header}`,
    `<i>${reminders.length} tasks${formattedDate ? ` - ${formattedDate}` : ''}</i>`,
    '',
  ];

  // Add each task
  reminders.forEach((reminder, index) => {
    const { task } = reminder;
    const taskLine = [`${index + 1}. ${escapeHtml(task.description)}`];

    // Add priority and file on same line
    const meta: string[] = [];
    if (task.priority !== 'none') {
      meta.push(PRIORITY_DISPLAY[task.priority]);
    }
    meta.push(`📂 ${escapeHtml(task.filePath)}`);

    if (meta.length > 0) {
      taskLine.push(`   ${meta.join(' · ')}`);
    }

    lines.push(taskLine.join('\n'));
    lines.push('');
  });

  return lines.join('\n').trim();
}

/**
 * Formats all reminders into messages
 * Groups by type and creates digest messages when multiple tasks share same due date
 */
export function formatAllReminders(reminders: Reminder[]): string[] {
  const messages: string[] = [];
  const grouped = groupRemindersByType(reminders);

  // Process in priority order: overdue -> due-now -> upcoming
  const typeOrder: ReminderType[] = ['overdue', 'due-now', 'upcoming'];

  for (const type of typeOrder) {
    const typeReminders = grouped.get(type);
    if (!typeReminders || typeReminders.length === 0) {
      continue;
    }

    // Group by due date within type
    const byDate = new Map<string, Reminder[]>();
    for (const r of typeReminders) {
      const date = r.task.dueDate || 'unknown';
      const existing = byDate.get(date) || [];
      existing.push(r);
      byDate.set(date, existing);
    }

    // Format each date group
    for (const dateReminders of byDate.values()) {
      messages.push(formatDigestMessage(dateReminders, type));
    }
  }

  return messages;
}

/**
 * Creates a Telegram bot instance (send-only, no polling)
 */
export function createBot(token: string): TelegramBot {
  return new TelegramBot(token);
}

/**
 * Sends a message to Telegram with retry logic
 */
async function sendWithRetry(
  bot: TelegramBot,
  chatId: string,
  message: string,
  maxRetries: number = 3
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      return;
    } catch (error) {
      lastError = error as Error;

      // Don't retry on certain errors
      if (error instanceof Error) {
        if (
          error.message.includes('Unauthorized') ||
          error.message.includes('chat not found')
        ) {
          throw error;
        }
      }

      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Sends all reminder messages
 */
export async function sendReminders(
  bot: TelegramBot,
  chatId: string,
  reminders: Reminder[],
  dryRun: boolean = false
): Promise<SendResult> {
  const result: SendResult = {
    sent: 0,
    failed: 0,
    errors: [],
  };

  const messages = formatAllReminders(reminders);

  for (const message of messages) {
    if (dryRun) {
      console.log('--- DRY RUN: Would send message ---');
      console.log(message.replace(/<[^>]+>/g, '')); // Strip HTML for console
      console.log('-----------------------------------');
      result.sent++;
      continue;
    }

    try {
      await sendWithRetry(bot, chatId, message);
      result.sent++;

      // Rate limiting: small delay between messages
      if (messages.length > 5) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (error) {
      result.failed++;
      result.errors.push(
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  return result;
}

/**
 * Sends a startup/test message
 */
export async function sendStartupMessage(
  bot: TelegramBot,
  chatId: string
): Promise<boolean> {
  try {
    await bot.sendMessage(
      chatId,
      '✅ <b>Obsidian Reminder Bot Connected</b>\n\nI will send you task reminders based on your Obsidian vault.',
      { parse_mode: 'HTML' }
    );
    return true;
  } catch (error) {
    console.error('Failed to send startup message:', error);
    return false;
  }
}

/**
 * Formats a status message showing tasks due today and upcoming
 */
export function formatStatusMessage(
  todayTasks: Reminder[],
  upcomingTasks: Reminder[]
): string {
  const lines: string[] = ['📊 <b>Task Status</b>', ''];

  if (todayTasks.length === 0 && upcomingTasks.length === 0) {
    lines.push('🎉 No upcoming tasks!');
    return lines.join('\n');
  }

  if (todayTasks.length > 0) {
    lines.push(`<b>Due Today (${todayTasks.length})</b>`);
    for (const r of todayTasks) {
      lines.push(`• ${escapeHtml(r.task.description)}`);
    }
    lines.push('');
  }

  if (upcomingTasks.length > 0) {
    lines.push(`<b>Upcoming (${upcomingTasks.length})</b>`);
    for (const r of upcomingTasks) {
      const dueInfo = r.task.dueDate
        ? ` (${format(parseISO(r.task.dueDate), 'MMM d')})`
        : '';
      lines.push(`• ${escapeHtml(r.task.description)}${dueInfo}`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats an upcoming tasks message (next 7 days)
 */
export function formatUpcomingMessage(reminders: Reminder[]): string {
  const lines: string[] = ['📅 <b>Tasks Due in Next 7 Days</b>', ''];

  if (reminders.length === 0) {
    lines.push('🎉 No tasks due in the next 7 days!');
    return lines.join('\n');
  }

  // Group by due date
  const byDate = new Map<string, Reminder[]>();
  for (const r of reminders) {
    const date = r.task.dueDate || 'unknown';
    const existing = byDate.get(date) || [];
    existing.push(r);
    byDate.set(date, existing);
  }

  // Sort dates
  const sortedDates = [...byDate.keys()].sort();

  for (const date of sortedDates) {
    const dateReminders = byDate.get(date)!;
    lines.push(`<b>${formatDate(date)}</b>`);
    for (const r of dateReminders) {
      const priority =
        r.task.priority !== 'none' ? ` ${PRIORITY_DISPLAY[r.task.priority]}` : '';
      lines.push(`• ${escapeHtml(r.task.description)}${priority}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}
