/**
 * Reminder Engine module
 * Determines which reminders need to be sent based on task due dates and sent history
 */

import { parseISO, differenceInDays, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type { Task, Reminder, ReminderType, SentLog, AppConfig } from './types.js';
import {
  generateReminderKey,
  isReminderSent,
} from './sent-log.js';

/**
 * Determines the reminder type based on days until due
 */
function getReminderType(daysUntilDue: number): ReminderType {
  if (daysUntilDue < 0) {
    return 'overdue';
  } else if (daysUntilDue === 0) {
    return 'due-today';
  } else if (daysUntilDue === 1) {
    return '1-day-before';
  } else {
    return '2-days-before';
  }
}

/**
 * Calculates days until a due date from a reference date
 * Uses timezone-aware date comparison
 */
export function calculateDaysUntilDue(
  dueDate: string,
  referenceDate: Date,
  timezone: string
): number {
  // Parse the due date as a local date in the target timezone
  const dueDateParsed = parseISO(dueDate);

  // Get today in the target timezone
  const todayInTz = toZonedTime(referenceDate, timezone);
  const todayStart = startOfDay(todayInTz);

  // Calculate difference in days
  return differenceInDays(dueDateParsed, todayStart);
}

/**
 * Evaluates a single task and determines if reminders are needed
 */
export function evaluateTask(
  task: Task,
  today: Date,
  config: Pick<AppConfig, 'reminderDays' | 'timezone' | 'includeScheduled'>,
  sentLog: SentLog
): Reminder[] {
  const reminders: Reminder[] = [];

  // Check due date reminders
  if (task.dueDate) {
    const daysUntilDue = calculateDaysUntilDue(task.dueDate, today, config.timezone);

    // Check if this falls within our reminder days
    const shouldRemind =
      config.reminderDays.includes(daysUntilDue) ||
      // Also check for overdue (between -7 and -1)
      (daysUntilDue >= -7 && daysUntilDue < 0);

    if (shouldRemind) {
      const key = generateReminderKey(
        task.filePath,
        task.rawLine,
        task.dueDate,
        daysUntilDue
      );

      // Check if already sent
      if (!isReminderSent(sentLog, key)) {
        reminders.push({
          task,
          reminderType: getReminderType(daysUntilDue),
          daysUntilDue,
          key,
        });
      }
    }
  }

  // Check scheduled date reminders if enabled
  if (config.includeScheduled && task.scheduledDate) {
    const daysUntilScheduled = calculateDaysUntilDue(
      task.scheduledDate,
      today,
      config.timezone
    );

    if (config.reminderDays.includes(daysUntilScheduled)) {
      const key = generateReminderKey(
        task.filePath,
        task.rawLine,
        task.scheduledDate,
        daysUntilScheduled
      );

      if (!isReminderSent(sentLog, key)) {
        reminders.push({
          task,
          reminderType: getReminderType(daysUntilScheduled),
          daysUntilDue: daysUntilScheduled,
          key,
        });
      }
    }
  }

  return reminders;
}

/**
 * Evaluates all tasks and returns reminders that need to be sent
 */
export function evaluateReminders(
  tasks: Task[],
  today: Date,
  config: Pick<AppConfig, 'reminderDays' | 'timezone' | 'includeScheduled'>,
  sentLog: SentLog
): Reminder[] {
  const reminders: Reminder[] = [];

  for (const task of tasks) {
    // Skip done tasks
    if (task.isDone) {
      continue;
    }

    const taskReminders = evaluateTask(task, today, config, sentLog);
    reminders.push(...taskReminders);
  }

  // Sort by days until due (most urgent first)
  reminders.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  return reminders;
}

/**
 * Groups reminders by their reminder type for digest messages
 */
export function groupRemindersByType(
  reminders: Reminder[]
): Map<ReminderType, Reminder[]> {
  const groups = new Map<ReminderType, Reminder[]>();

  for (const reminder of reminders) {
    const existing = groups.get(reminder.reminderType) || [];
    existing.push(reminder);
    groups.set(reminder.reminderType, existing);
  }

  return groups;
}

/**
 * Groups reminders by due date for date-based digest
 */
export function groupRemindersByDate(
  reminders: Reminder[]
): Map<string, Reminder[]> {
  const groups = new Map<string, Reminder[]>();

  for (const reminder of reminders) {
    const dueDate = reminder.task.dueDate || reminder.task.scheduledDate || 'unknown';
    const existing = groups.get(dueDate) || [];
    existing.push(reminder);
    groups.set(dueDate, existing);
  }

  return groups;
}

/**
 * Gets a summary of pending reminders
 */
export function getReminderSummary(reminders: Reminder[]): {
  total: number;
  overdue: number;
  dueToday: number;
  dueTomorrow: number;
  dueSoon: number;
} {
  let overdue = 0;
  let dueToday = 0;
  let dueTomorrow = 0;
  let dueSoon = 0;

  for (const reminder of reminders) {
    if (reminder.daysUntilDue < 0) {
      overdue++;
    } else if (reminder.daysUntilDue === 0) {
      dueToday++;
    } else if (reminder.daysUntilDue === 1) {
      dueTomorrow++;
    } else {
      dueSoon++;
    }
  }

  return {
    total: reminders.length,
    overdue,
    dueToday,
    dueTomorrow,
    dueSoon,
  };
}
