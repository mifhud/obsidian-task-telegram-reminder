/**
 * Unit tests for the reminder engine module
 */

import { describe, it, expect } from 'vitest';
import {
  calculateMinutesUntilDue,
  evaluateTask,
  evaluateReminders,
  groupRemindersByType,
  getReminderSummary,
  buildDueDateTime,
  formatMinutesDuration,
} from '../reminder-engine.js';
import type { Task, SentLog, AppConfig } from '../types.js';

// Helper to create a mock task
const createTask = (overrides: Partial<Task> = {}): Task => ({
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
  ...overrides,
});

// Helper to create empty sent log
const createEmptySentLog = (): SentLog => ({
  reminders: {},
  lastCleanup: new Date().toISOString().split('T')[0],
});

// Default config for tests — reminderMinutes thresholds in minutes
const defaultConfig: Pick<AppConfig, 'reminderMinutes' | 'overdueMinutes' | 'timezone' | 'includeScheduled'> = {
  reminderMinutes: [2880, 1440, 60, 0], // 2d, 1d, 1h, now
  overdueMinutes: 10080, // 7 days
  timezone: 'UTC',
  includeScheduled: false,
};

describe('buildDueDateTime', () => {
  it('should default to 00:00 when no startTime', () => {
    const dt = buildDueDateTime('2026-04-15', null);
    expect(dt.getHours()).toBe(0);
    expect(dt.getMinutes()).toBe(0);
  });

  it('should use startTime when provided', () => {
    const dt = buildDueDateTime('2026-04-15', '14:30');
    expect(dt.getHours()).toBe(14);
    expect(dt.getMinutes()).toBe(30);
  });
});

describe('calculateMinutesUntilDue', () => {
  it('should return 0 when exactly at due time', () => {
    const dueDate = '2026-04-15';
    const today = new Date('2026-04-15T00:00:00Z');

    const minutes = calculateMinutesUntilDue(dueDate, null, today, 'UTC');

    expect(minutes).toBe(0);
  });

  it('should return 1440 for a task due tomorrow at 00:00', () => {
    const dueDate = '2026-04-16';
    const today = new Date('2026-04-15T00:00:00Z');

    const minutes = calculateMinutesUntilDue(dueDate, null, today, 'UTC');

    expect(minutes).toBe(1440);
  });

  it('should return negative minutes for overdue tasks', () => {
    const dueDate = '2026-04-14';
    const today = new Date('2026-04-15T00:00:00Z');

    const minutes = calculateMinutesUntilDue(dueDate, null, today, 'UTC');

    expect(minutes).toBe(-1440);
  });

  it('should use startTime for minute precision', () => {
    const dueDate = '2026-04-15';
    const today = new Date('2026-04-15T13:00:00Z');

    const minutes = calculateMinutesUntilDue(dueDate, '14:00', today, 'UTC');

    expect(minutes).toBe(60);
  });

  it('should return negative when past the startTime', () => {
    const dueDate = '2026-04-15';
    const today = new Date('2026-04-15T15:00:00Z');

    const minutes = calculateMinutesUntilDue(dueDate, '14:00', today, 'UTC');

    expect(minutes).toBe(-60);
  });
});

describe('evaluateTask', () => {
  it('should trigger threshold when minutesUntilDue <= threshold', () => {
    // Task due in 1 day (1440 min), thresholds: [2880, 1440, 60, 0]
    // Fires for thresholds where minutesUntilDue <= threshold: 2880 and 1440
    const task = createTask({ dueDate: '2026-04-16' });
    const today = new Date('2026-04-15T00:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateTask(task, today, defaultConfig, sentLog);

    // Should trigger for thresholds 2880 and 1440 (both >= 1440)
    expect(reminders.length).toBe(2);
    const thresholds = reminders.map((r) => r.thresholdMinutes).sort((a, b) => a - b);
    expect(thresholds).toEqual([1440, 2880]);
  });

  it('should trigger upcoming type for future tasks', () => {
    const task = createTask({ dueDate: '2026-04-16' });
    const today = new Date('2026-04-15T00:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateTask(task, today, defaultConfig, sentLog);

    expect(reminders.every((r) => r.reminderType === 'upcoming' || r.reminderType === 'due-now')).toBe(true);
  });

  it('should trigger due-now when minutesUntilDue is 0', () => {
    const task = createTask({ dueDate: '2026-04-15' });
    const today = new Date('2026-04-15T00:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateTask(task, today, defaultConfig, sentLog);

    const dueNowReminder = reminders.find((r) => r.thresholdMinutes === 0);
    expect(dueNowReminder?.reminderType).toBe('due-now');
  });

  it('should trigger overdue for tasks past due within overdueMinutes', () => {
    // Task was due 1 day ago (1440 min overdue), overdueMinutes=10080
    const task = createTask({ dueDate: '2026-04-14' });
    const today = new Date('2026-04-15T00:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateTask(task, today, defaultConfig, sentLog);

    const overdueReminder = reminders.find((r) => r.reminderType === 'overdue');
    expect(overdueReminder).toBeDefined();
    expect(overdueReminder?.minutesUntilDue).toBe(-1440);
  });

  it('should not trigger overdue beyond overdueMinutes', () => {
    // Task was due 8 days ago (11520 min), overdueMinutes=10080
    const task = createTask({ dueDate: '2026-04-07' });
    const today = new Date('2026-04-15T00:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateTask(task, today, defaultConfig, sentLog);

    expect(reminders.length).toBe(0);
  });

  it('should not create reminder if already sent', () => {
    const task = createTask({ dueDate: '2026-04-15' });
    const today = new Date('2026-04-15T00:00:00Z');
    const sentLog = createEmptySentLog();

    // First evaluation creates reminders
    const firstReminders = evaluateTask(task, today, defaultConfig, sentLog);
    expect(firstReminders.length).toBeGreaterThan(0);

    // Add all keys to sent log
    for (const r of firstReminders) {
      sentLog.reminders[r.key] = {
        sentAt: new Date().toISOString(),
        task: task.description,
        dueDate: task.dueDate!,
        reminderType: r.reminderType,
        filePath: task.filePath,
      };
    }

    // Second evaluation should produce no reminders
    const secondReminders = evaluateTask(task, today, defaultConfig, sentLog);
    expect(secondReminders.length).toBe(0);
  });

  it('should use startTime for minute-level precision', () => {
    // Task due today at 14:00, current time is 13:00 → 60 min away
    // Thresholds: [2880, 1440, 60, 0]; fires for thresholds >= 60: 2880, 1440, 60
    const task = createTask({ dueDate: '2026-04-15', startTime: '14:00' });
    const today = new Date('2026-04-15T13:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateTask(task, today, defaultConfig, sentLog);

    const thresholds = reminders.map((r) => r.thresholdMinutes).sort((a, b) => a - b);
    expect(thresholds).toEqual([60, 1440, 2880]);
    expect(reminders.every((r) => r.minutesUntilDue === 60)).toBe(true);
  });

  it('should handle scheduled dates when enabled', () => {
    const task = createTask({
      dueDate: null,
      scheduledDate: '2026-04-15',
    });
    const today = new Date('2026-04-15T00:00:00Z');
    const sentLog = createEmptySentLog();

    const configWithScheduled = { ...defaultConfig, includeScheduled: true };
    const reminders = evaluateTask(task, today, configWithScheduled, sentLog);

    expect(reminders.length).toBeGreaterThan(0);
  });

  it('should not remind for scheduled dates when disabled', () => {
    const task = createTask({
      dueDate: null,
      scheduledDate: '2026-04-15',
    });
    const today = new Date('2026-04-15T00:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateTask(task, today, defaultConfig, sentLog);

    expect(reminders.length).toBe(0);
  });
});

describe('evaluateReminders', () => {
  it('should skip done tasks', () => {
    const tasks = [
      createTask({ isDone: true, dueDate: '2026-04-15' }),
      createTask({ isDone: false, dueDate: '2026-04-15' }),
    ];
    const today = new Date('2026-04-15T00:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateReminders(tasks, today, defaultConfig, sentLog);

    // All reminders should be from the non-done task
    expect(reminders.every((r) => !r.task.isDone)).toBe(true);
  });

  it('should sort reminders by urgency (most urgent first)', () => {
    const tasks = [
      createTask({ description: 'Far', dueDate: '2026-04-17' }),
      createTask({ description: 'Near', dueDate: '2026-04-15' }),
    ];
    const today = new Date('2026-04-15T00:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateReminders(tasks, today, defaultConfig, sentLog);

    // Most urgent (smallest minutesUntilDue) should be first
    expect(reminders[0].minutesUntilDue).toBeLessThanOrEqual(reminders[reminders.length - 1].minutesUntilDue);
  });
});

describe('groupRemindersByType', () => {
  it('should group reminders by type', () => {
    const tasks = [
      createTask({ description: 'Task 1', dueDate: '2026-04-15' }),
      createTask({ description: 'Task 2', dueDate: '2026-04-15' }),
      createTask({ description: 'Task 3', dueDate: '2026-04-17' }),
    ];
    const today = new Date('2026-04-15T00:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateReminders(tasks, today, defaultConfig, sentLog);
    const grouped = groupRemindersByType(reminders);

    // Due-now reminders for tasks due today (threshold 0)
    expect(grouped.get('due-now')?.length).toBeGreaterThan(0);
    // Upcoming reminders for tasks due later
    expect(grouped.get('upcoming')?.length).toBeGreaterThan(0);
  });
});

describe('getReminderSummary', () => {
  it('should calculate summary correctly', () => {
    const tasks = [
      createTask({ description: 'Overdue', dueDate: '2026-04-13' }),
      createTask({ description: 'Today', dueDate: '2026-04-15' }),
      createTask({ description: 'Upcoming', dueDate: '2026-04-17' }),
    ];
    const today = new Date('2026-04-15T00:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateReminders(tasks, today, defaultConfig, sentLog);
    const summary = getReminderSummary(reminders);

    expect(summary.total).toBeGreaterThan(0);
    expect(summary.overdue).toBeGreaterThan(0);
    expect(summary.upcoming).toBeGreaterThan(0);
  });
});

describe('formatMinutesDuration', () => {
  it('should format minutes correctly', () => {
    expect(formatMinutesDuration(0)).toBe('0 minutes');
    expect(formatMinutesDuration(1)).toBe('1 minute');
    expect(formatMinutesDuration(30)).toBe('30 minutes');
    expect(formatMinutesDuration(60)).toBe('1 hour');
    expect(formatMinutesDuration(120)).toBe('2 hours');
    expect(formatMinutesDuration(1440)).toBe('1 day');
    expect(formatMinutesDuration(2880)).toBe('2 days');
  });

  it('should handle negative values (overdue)', () => {
    expect(formatMinutesDuration(-60)).toBe('1 hour');
    expect(formatMinutesDuration(-1440)).toBe('1 day');
  });
});
