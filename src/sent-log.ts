/**
 * Sent Log module
 * Manages persistence of sent reminders to prevent duplicates
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';
import type { SentLog, SentReminderEntry, Reminder } from './types.js';

/**
 * Creates an empty sent log structure
 */
function createEmptySentLog(): SentLog {
  return {
    reminders: {},
    lastCleanup: new Date().toISOString().split('T')[0],
  };
}

/**
 * Loads the sent log from disk
 */
export function loadSentLog(logPath: string): SentLog {
  const resolvedPath = resolve(logPath);

  if (!existsSync(resolvedPath)) {
    return createEmptySentLog();
  }

  try {
    const content = readFileSync(resolvedPath, 'utf-8');
    const parsed = JSON.parse(content) as SentLog;

    // Validate structure
    if (!parsed.reminders || typeof parsed.reminders !== 'object') {
      console.warn('Invalid sent log structure, resetting to empty');
      return createEmptySentLog();
    }

    return parsed;
  } catch (error) {
    console.warn('Failed to parse sent log, resetting to empty:', error);
    return createEmptySentLog();
  }
}

/**
 * Saves the sent log to disk
 */
export function saveSentLog(logPath: string, log: SentLog): void {
  const resolvedPath = resolve(logPath);

  try {
    const content = JSON.stringify(log, null, 2);
    writeFileSync(resolvedPath, content, 'utf-8');
  } catch (error) {
    console.error('Failed to save sent log:', error);
    throw error;
  }
}

/**
 * Generates a unique key for a reminder
 * Key is based on: file path + line content hash + due date + threshold minutes
 * threshold = -1 is the special sentinel for the overdue reminder
 */
export function generateReminderKey(
  filePath: string,
  rawLine: string,
  dueDate: string,
  thresholdMinutes: number
): string {
  // Create a hash of the line content to handle edits
  const lineHash = createHash('md5')
    .update(rawLine)
    .digest('hex')
    .substring(0, 8);

  // Determine reminder type identifier
  const reminderTypeId =
    thresholdMinutes < 0 ? `overdue-${Math.abs(thresholdMinutes)}m` : `${thresholdMinutes}m`;

  return `${filePath}:${lineHash}:${dueDate}:${reminderTypeId}`;
}

/**
 * Checks if a reminder has already been sent
 */
export function isReminderSent(log: SentLog, key: string): boolean {
  return key in log.reminders;
}

/**
 * Records a sent reminder in the log
 */
export function recordSentReminder(
  log: SentLog,
  reminder: Reminder,
  sentAt: Date = new Date()
): void {
  const entry: SentReminderEntry = {
    sentAt: sentAt.toISOString(),
    task: reminder.task.description,
    dueDate: (reminder.task.dueDate || reminder.task.scheduledDate)!,
    reminderType: reminder.reminderType,
    filePath: reminder.task.filePath,
  };

  log.reminders[reminder.key] = entry;
}

/**
 * Cleans up old entries from the sent log
 * Removes entries older than the specified number of days
 */
export function cleanupSentLog(log: SentLog, maxAgeDays: number = 30): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

  let removedCount = 0;
  const keysToRemove: string[] = [];

  for (const [key, entry] of Object.entries(log.reminders)) {
    const sentDate = new Date(entry.sentAt);
    if (sentDate < cutoffDate) {
      keysToRemove.push(key);
      removedCount++;
    }
  }

  for (const key of keysToRemove) {
    delete log.reminders[key];
  }

  // Update last cleanup date
  log.lastCleanup = new Date().toISOString().split('T')[0];

  return removedCount;
}

/**
 * Checks if cleanup is needed (once per day)
 */
export function needsCleanup(log: SentLog): boolean {
  const today = new Date().toISOString().split('T')[0];
  return log.lastCleanup !== today;
}

/**
 * Gets statistics about the sent log
 */
export function getSentLogStats(log: SentLog): {
  totalEntries: number;
  oldestEntry: string | null;
  newestEntry: string | null;
} {
  const entries = Object.values(log.reminders);

  if (entries.length === 0) {
    return {
      totalEntries: 0,
      oldestEntry: null,
      newestEntry: null,
    };
  }

  const sorted = entries.sort(
    (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
  );

  return {
    totalEntries: entries.length,
    oldestEntry: sorted[0].sentAt,
    newestEntry: sorted[sorted.length - 1].sentAt,
  };
}
