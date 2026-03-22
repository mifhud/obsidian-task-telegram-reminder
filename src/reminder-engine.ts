/**
 * Reminder Engine module
 * Determines which reminders need to be sent based on task due datetimes and sent history
 */

import { parseISO, differenceInMinutes, set } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type { Task, Reminder, ReminderType, SentLog, AppConfig } from './types.js';
import {
  generateReminderKey,
  isReminderSent,
} from './sent-log.js';

/**
 * Determines the reminder type based on minutes until due
 */
function getReminderType(minutesUntilDue: number): ReminderType {
  if (minutesUntilDue < 0) {
    return 'overdue';
  } else {
    return minutesUntilDue === 0 ? 'due-now' : 'upcoming';
  }
}

/**
 * Builds a full Date from a YYYY-MM-DD date string and an optional HH:mm time string.
 * When no time is provided, defaults to 23:59 (end of day).
 */
export function buildDueDateTime(
  dueDate: string,
  endTime: string | null
): Date {
  const base = parseISO(dueDate);
  if (!endTime) {
    return set(base, { hours: 23, minutes: 59, seconds: 0, milliseconds: 0 });
  }
  const [hours, minutes] = endTime.split(':').map(Number);
  return set(base, { hours, minutes, seconds: 0, milliseconds: 0 });
}

/**
 * Calculates minutes until a due datetime from a reference date.
 * Uses timezone-aware comparison.
 */
export function calculateMinutesUntilDue(
  dueDate: string,
  endTime: string | null,
  referenceDate: Date,
  timezone: string
): number {
  const dueDateTimeLocal = buildDueDateTime(dueDate, endTime);

  // Get the reference time in the target timezone
  const refInTz = toZonedTime(referenceDate, timezone);

  return differenceInMinutes(dueDateTimeLocal, refInTz);
}

/**
 * Evaluates a single task and determines if reminders are needed.
 * Uses a threshold approach: for each value in reminderMinutes, fire when
 * minutesUntilDue <= threshold and that threshold key hasn't been sent yet.
 */
export function evaluateTask(
  task: Task,
  today: Date,
  config: Pick<AppConfig, 'reminderMinutes' | 'overdueMinutes' | 'timezone' | 'includeScheduled'>,
  sentLog: SentLog
): Reminder[] {
  const reminders: Reminder[] = [];

  // Check due date reminders
  if (task.dueDate) {
    const minutesUntilDue = calculateMinutesUntilDue(
      task.dueDate,
      task.endTime,
      today,
      config.timezone
    );

    if (minutesUntilDue >= 0) {
      // Check each threshold: fire when task is within X minutes of due time
      for (const threshold of config.reminderMinutes) {
        if (minutesUntilDue <= threshold) {
          const key = generateReminderKey(
            task.filePath,
            task.rawLine,
            task.dueDate,
            threshold
          );

          if (!isReminderSent(sentLog, key)) {
            reminders.push({
              task,
              reminderType: getReminderType(minutesUntilDue),
              minutesUntilDue,
              thresholdMinutes: threshold,
              key,
            });
          }
        }
      }
    } else {
      // Overdue: iterate thresholds like upcoming reminders
      const overdueMinutes = Math.abs(minutesUntilDue);
      for (const threshold of config.overdueMinutes) {
        if (overdueMinutes >= threshold) {
          const overdueKey = generateReminderKey(
            task.filePath,
            task.rawLine,
            task.dueDate,
            -threshold
          );

          if (!isReminderSent(sentLog, overdueKey)) {
            reminders.push({
              task,
              reminderType: 'overdue',
              minutesUntilDue,
              thresholdMinutes: -threshold,
              key: overdueKey,
            });
          }
        }
      }
    }
  }

  // Check scheduled date reminders if enabled
  if (config.includeScheduled && task.scheduledDate) {
    const minutesUntilScheduled = calculateMinutesUntilDue(
      task.scheduledDate,
      task.endTime,
      today,
      config.timezone
    );

    if (minutesUntilScheduled >= 0) {
      for (const threshold of config.reminderMinutes) {
        if (minutesUntilScheduled <= threshold) {
          const key = generateReminderKey(
            task.filePath,
            task.rawLine,
            task.scheduledDate,
            threshold
          );

          if (!isReminderSent(sentLog, key)) {
            reminders.push({
              task,
              reminderType: getReminderType(minutesUntilScheduled),
              minutesUntilDue: minutesUntilScheduled,
              thresholdMinutes: threshold,
              key,
            });
          }
        }
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
  config: Pick<AppConfig, 'reminderMinutes' | 'overdueMinutes' | 'timezone' | 'includeScheduled'>,
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

  // Sort by minutes until due (most urgent first)
  reminders.sort((a, b) => a.minutesUntilDue - b.minutesUntilDue);

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
  dueNow: number;
  upcoming: number;
} {
  let overdue = 0;
  let dueNow = 0;
  let upcoming = 0;

  for (const reminder of reminders) {
    if (reminder.reminderType === 'overdue') {
      overdue++;
    } else if (reminder.reminderType === 'due-now') {
      dueNow++;
    } else {
      upcoming++;
    }
  }

  return {
    total: reminders.length,
    overdue,
    dueNow,
    upcoming,
  };
}

/**
 * Formats minutes into a human-readable duration string
 */
export function formatMinutesDuration(minutes: number): string {
  const abs = Math.abs(minutes);
  if (abs >= 1440) {
    const days = Math.round(abs / 1440);
    return `${days} day${days !== 1 ? 's' : ''}`;
  } else if (abs >= 60) {
    const hours = Math.round(abs / 60);
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  return `${abs} minute${abs !== 1 ? 's' : ''}`;
}
