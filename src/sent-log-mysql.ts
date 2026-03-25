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
