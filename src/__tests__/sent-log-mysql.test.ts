/**
 * Unit tests for the MySQL sent-log module
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Reminder } from '../types.js';

// Mock mysql2/promise before importing modules that use it
const mockExecute = vi.fn();
const mockEnd = vi.fn();

vi.mock('mysql2/promise', () => ({
  createPool: vi.fn(() => ({
    execute: mockExecute,
    end: mockEnd,
  })),
}));

// Mock logger
vi.mock('../logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocks are set up
import {
  generateReminderKey,
  isReminderSent,
  recordSentReminder,
  cleanupSentLog,
  needsCleanup,
  getSentLogStats,
} from '../sent-log-mysql.js';
import { createDatabasePool } from '../database.js';

const createMockReminder = (overrides: Partial<Reminder> = {}): Reminder => ({
  task: {
    description: 'Test task',
    dueDate: '2026-04-15',
    scheduledDate: null,
    startDate: null,
    createdDate: null,
    endTime: null,
    isDone: false,
    priority: 'none',
    filePath: 'test.md',
    lineNumber: 1,
    rawLine: '- [ ] Test task 📅 2026-04-15',
    recurrence: null,
  },
  reminderType: 'due-now',
  reminderSource: 'due',
  minutesUntilDue: 0,
  thresholdMinutes: 0,
  key: 'test-key-123',
  ...overrides,
});

describe('sent-log-mysql', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Initialize database pool (with mock)
    createDatabasePool({
      host: 'localhost',
      port: 3306,
      user: 'test',
      password: 'test',
      database: 'test',
    });
  });

  describe('generateReminderKey', () => {
    it('should generate consistent keys', () => {
      const key1 = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', 0);
      const key2 = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', 0);

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different thresholds', () => {
      const key1 = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', 0);
      const key2 = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', 60);

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different tasks', () => {
      const key1 = generateReminderKey('test.md', '- [ ] Task 1', '2026-04-15', 0);
      const key2 = generateReminderKey('test.md', '- [ ] Task 2', '2026-04-15', 0);

      expect(key1).not.toBe(key2);
    });

    it('should include overdue indicator for negative thresholds', () => {
      const key = generateReminderKey('test.md', '- [ ] Task', '2026-04-15', -1440);

      expect(key).toContain('overdue-1440m');
    });
  });

  describe('isReminderSent', () => {
    it('should return false when reminder not found', async () => {
      mockExecute.mockResolvedValueOnce([[]]);

      const result = await isReminderSent('new-key');

      expect(result).toBe(false);
      expect(mockExecute).toHaveBeenCalledWith(
        'SELECT 1 FROM sent_reminders WHERE reminder_key = ? LIMIT 1',
        ['new-key']
      );
    });

    it('should return true when reminder exists', async () => {
      mockExecute.mockResolvedValueOnce([[{ 1: 1 }]]);

      const result = await isReminderSent('existing-key');

      expect(result).toBe(true);
    });
  });

  describe('recordSentReminder', () => {
    it('should insert reminder into database', async () => {
      mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const reminder = createMockReminder();

      await recordSentReminder(reminder);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sent_reminders'),
        expect.arrayContaining([reminder.key, reminder.task.description])
      );
    });
  });

  describe('cleanupSentLog', () => {
    it('should delete old entries', async () => {
      mockExecute.mockResolvedValueOnce([{ affectedRows: 5 }]);

      const removed = await cleanupSentLog(30);

      expect(removed).toBe(5);
      expect(mockExecute).toHaveBeenCalledWith(
        'DELETE FROM sent_reminders WHERE sent_at < ?',
        expect.any(Array)
      );
    });
  });

  describe('needsCleanup', () => {
    it('should return boolean', () => {
      const result = needsCleanup();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getSentLogStats', () => {
    it('should return correct stats for empty database', async () => {
      mockExecute.mockResolvedValueOnce([[{ count: 0 }]]);

      const stats = await getSentLogStats();

      expect(stats.totalEntries).toBe(0);
      expect(stats.oldestEntry).toBeNull();
      expect(stats.newestEntry).toBeNull();
    });

    it('should return correct stats for populated database', async () => {
      mockExecute
        .mockResolvedValueOnce([[{ count: 5 }]])
        .mockResolvedValueOnce([[{ oldest: new Date('2026-04-14T10:00:00Z') }]])
        .mockResolvedValueOnce([[{ newest: new Date('2026-04-15T10:00:00Z') }]]);

      const stats = await getSentLogStats();

      expect(stats.totalEntries).toBe(5);
      expect(stats.oldestEntry).toContain('2026-04-14');
      expect(stats.newestEntry).toContain('2026-04-15');
    });
  });
});
