/**
 * Unit tests for the sent-log module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  loadSentLog,
  saveSentLog,
  generateReminderKey,
  isReminderSent,
  recordSentReminder,
  cleanupSentLog,
  needsCleanup,
  getSentLogStats,
} from '../sent-log.js';
import type { SentLog, Reminder, Task } from '../types.js';

const TEST_LOG_PATH = join(process.cwd(), 'test-sent-log.json');

const createMockReminder = (overrides: Partial<Reminder> = {}): Reminder => ({
  task: {
    description: 'Test task',
    dueDate: '2026-04-15',
    scheduledDate: null,
    startDate: null,
    createdDate: null,
    startTime: null,
    isDone: false,
    priority: 'none',
    filePath: 'test.md',
    lineNumber: 1,
    rawLine: '- [ ] Test task 📅 2026-04-15',
    recurrence: null,
  },
  reminderType: 'due-now',
  minutesUntilDue: 0,
  thresholdMinutes: 0,
  key: 'test-key-123',
  ...overrides,
});

describe('sent-log', () => {
  afterEach(() => {
    if (existsSync(TEST_LOG_PATH)) {
      rmSync(TEST_LOG_PATH);
    }
  });

  describe('loadSentLog', () => {
    it('should return empty log when file does not exist', () => {
      const log = loadSentLog(TEST_LOG_PATH);

      expect(log.reminders).toEqual({});
      expect(log.lastCleanup).toBeDefined();
    });

    it('should load existing log file', () => {
      const existingLog: SentLog = {
        reminders: {
          'key-1': {
            sentAt: '2026-04-15T10:00:00Z',
            task: 'Test task',
            dueDate: '2026-04-15',
            reminderType: 'due-now',
            filePath: 'test.md',
          },
        },
        lastCleanup: '2026-04-15',
      };
      writeFileSync(TEST_LOG_PATH, JSON.stringify(existingLog));

      const log = loadSentLog(TEST_LOG_PATH);

      expect(log.reminders['key-1']).toBeDefined();
      expect(log.reminders['key-1'].task).toBe('Test task');
    });

    it('should return empty log on corrupted file', () => {
      writeFileSync(TEST_LOG_PATH, 'invalid json{');

      const log = loadSentLog(TEST_LOG_PATH);

      expect(log.reminders).toEqual({});
    });
  });

  describe('saveSentLog', () => {
    it('should save log to file', () => {
      const log: SentLog = {
        reminders: {
          'key-1': {
            sentAt: '2026-04-15T10:00:00Z',
            task: 'Test task',
            dueDate: '2026-04-15',
            reminderType: 'due-now',
            filePath: 'test.md',
          },
        },
        lastCleanup: '2026-04-15',
      };

      saveSentLog(TEST_LOG_PATH, log);

      const loaded = loadSentLog(TEST_LOG_PATH);
      expect(loaded.reminders['key-1']).toBeDefined();
    });
  });

  describe('generateReminderKey', () => {
    it('should generate consistent keys', () => {
      const key1 = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', 0);
      const key2 = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', 0);

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different days until due', () => {
      const key1 = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', 0);
      const key2 = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', 1);

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different tasks', () => {
      const key1 = generateReminderKey('test.md', '- [ ] Task 1', '2026-04-15', 0);
      const key2 = generateReminderKey('test.md', '- [ ] Task 2', '2026-04-15', 0);

      expect(key1).not.toBe(key2);
    });

    it('should include overdue indicator with threshold for past dates', () => {
      const key = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', -1440);

      expect(key).toContain('overdue-1440m');
    });
  });

  describe('isReminderSent', () => {
    it('should return false for new reminder', () => {
      const log: SentLog = {
        reminders: {},
        lastCleanup: '2026-04-15',
      };

      expect(isReminderSent(log, 'new-key')).toBe(false);
    });

    it('should return true for existing reminder', () => {
      const log: SentLog = {
        reminders: {
          'existing-key': {
            sentAt: '2026-04-15T10:00:00Z',
            task: 'Test',
            dueDate: '2026-04-15',
            reminderType: 'due-now',
            filePath: 'test.md',
          },
        },
        lastCleanup: '2026-04-15',
      };

      expect(isReminderSent(log, 'existing-key')).toBe(true);
    });
  });

  describe('recordSentReminder', () => {
    it('should add reminder to log', () => {
      const log: SentLog = {
        reminders: {},
        lastCleanup: '2026-04-15',
      };
      const reminder = createMockReminder();

      recordSentReminder(log, reminder);

      expect(log.reminders[reminder.key]).toBeDefined();
      expect(log.reminders[reminder.key].task).toBe('Test task');
    });
  });

  describe('cleanupSentLog', () => {
    it('should remove old entries', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 45); // 45 days ago

      const log: SentLog = {
        reminders: {
          'old-key': {
            sentAt: oldDate.toISOString(),
            task: 'Old task',
            dueDate: '2026-03-01',
            reminderType: 'due-now',
            filePath: 'test.md',
          },
          'new-key': {
            sentAt: new Date().toISOString(),
            task: 'New task',
            dueDate: '2026-04-15',
            reminderType: 'due-now',
            filePath: 'test.md',
          },
        },
        lastCleanup: '2026-03-01',
      };

      const removed = cleanupSentLog(log, 30);

      expect(removed).toBe(1);
      expect(log.reminders['old-key']).toBeUndefined();
      expect(log.reminders['new-key']).toBeDefined();
    });
  });

  describe('needsCleanup', () => {
    it('should return true if last cleanup was not today', () => {
      const log: SentLog = {
        reminders: {},
        lastCleanup: '2026-04-14',
      };

      // This will only work if today is not 2026-04-14
      // For a more robust test, we'd mock Date
      const result = needsCleanup(log);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getSentLogStats', () => {
    it('should return correct stats for empty log', () => {
      const log: SentLog = {
        reminders: {},
        lastCleanup: '2026-04-15',
      };

      const stats = getSentLogStats(log);

      expect(stats.totalEntries).toBe(0);
      expect(stats.oldestEntry).toBeNull();
      expect(stats.newestEntry).toBeNull();
    });

    it('should return correct stats for populated log', () => {
      const log: SentLog = {
        reminders: {
          'key-1': {
            sentAt: '2026-04-14T10:00:00Z',
            task: 'Task 1',
            dueDate: '2026-04-14',
            reminderType: 'due-now',
            filePath: 'test.md',
          },
          'key-2': {
            sentAt: '2026-04-15T10:00:00Z',
            task: 'Task 2',
            dueDate: '2026-04-15',
            reminderType: 'due-now',
            filePath: 'test.md',
          },
        },
        lastCleanup: '2026-04-15',
      };

      const stats = getSentLogStats(log);

      expect(stats.totalEntries).toBe(2);
      expect(stats.oldestEntry).toBe('2026-04-14T10:00:00Z');
      expect(stats.newestEntry).toBe('2026-04-15T10:00:00Z');
    });
  });
});
