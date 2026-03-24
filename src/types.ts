/**
 * Shared TypeScript interfaces for the Obsidian Telegram Reminder system
 */

/**
 * Task priority levels
 */
export type Priority = 'high' | 'medium' | 'low' | 'none';

/**
 * Represents a parsed task from an Obsidian markdown file
 */
export interface Task {
  /** Task description with emoji markers stripped */
  description: string;
  /** Due date in YYYY-MM-DD format, or null if not set */
  dueDate: string | null;
  /** Scheduled date in YYYY-MM-DD format, or null if not set */
  scheduledDate: string | null;
  /** Start date in YYYY-MM-DD format, or null if not set */
  startDate: string | null;
  /** Created date in YYYY-MM-DD format, or null if not set */
  createdDate: string | null;
  /** End time on the due date in HH:mm format, or null if not set */
  endTime: string | null;
  /** Whether the task is marked as done */
  isDone: boolean;
  /** Task priority level */
  priority: Priority;
  /** Relative path to the file within the vault */
  filePath: string;
  /** Line number in the file (1-indexed) */
  lineNumber: number;
  /** Original line content for debugging */
  rawLine: string;
  /** Recurrence rule if present */
  recurrence: string | null;
}

/**
 * Reminder types based on minutes until due
 */
export type ReminderType = 'overdue' | 'due-now' | 'upcoming';

/**
 * Represents a reminder to be sent
 */
export interface Reminder {
  /** The task this reminder is for */
  task: Task;
  /** Type of reminder */
  reminderType: ReminderType;
  /** Minutes until due (negative for overdue) */
  minutesUntilDue: number;
  /** The threshold value from reminderMinutes that triggered this reminder */
  thresholdMinutes: number;
  /** Unique key for deduplication */
  key: string;
}

/**
 * Entry in the sent reminders log
 */
export interface SentReminderEntry {
  /** ISO timestamp when the reminder was sent */
  sentAt: string;
  /** Task description */
  task: string;
  /** Due date of the task */
  dueDate: string;
  /** Type of reminder that was sent */
  reminderType: ReminderType;
  /** File path for reference */
  filePath: string;
}

/**
 * Structure of the sent-reminders.json file
 */
export interface SentLog {
  /** Map of reminder keys to their entries */
  reminders: Record<string, SentReminderEntry>;
  /** ISO date of last cleanup */
  lastCleanup: string;
}

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
  /** Path to the sent reminders log file */
  sentLogPath: string;
  /** IANA timezone string */
  timezone: string;
  /** Logging level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

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
}

/**
 * Complete configuration combining env and app config
 */
export interface Config extends EnvConfig, AppConfig {}

/**
 * Result of a scan cycle
 */
export interface ScanResult {
  /** All tasks found in the vault */
  tasks: Task[];
  /** Number of files scanned */
  filesScanned: number;
  /** Number of files skipped due to errors */
  filesSkipped: number;
  /** Duration of the scan in milliseconds */
  scanDurationMs: number;
}

/**
 * Result of sending reminders
 */
export interface SendResult {
  /** Number of reminders successfully sent */
  sent: number;
  /** Number of reminders that failed to send */
  failed: number;
  /** Error messages for failed sends */
  errors: string[];
}
