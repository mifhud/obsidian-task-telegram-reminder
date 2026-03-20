/**
 * Unit tests for the reminder engine module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateDaysUntilDue,
  evaluateTask,
  evaluateReminders,
  groupRemindersByType,
  getReminderSummary,
} from '../reminder-engine.js';
import type { Task, SentLog, AppConfig } from '../types.js';

// Helper to create a mock task
const createTask = (overrides: Partial<Task> = {}): Task => ({
  description: 'Test task',
  dueDate: '2026-04-15',
  scheduledDate: null,
  startDate: null,
  createdDate: null,
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

// Default config for tests
const defaultConfig: Pick<AppConfig, 'reminderDays' | 'timezone' | 'includeScheduled'> = {
  reminderDays: [2, 1, 0],
  timezone: 'UTC',
  includeScheduled: false,
};

describe('calculateDaysUntilDue', () => {
  it('should return 0 for same day', () => {
    const dueDate = '2026-04-15';
    const today = new Date('2026-04-15T10:00:00Z');

    const days = calculateDaysUntilDue(dueDate, today, 'UTC');

    expect(days).toBe(0);
  });

  it('should return positive days for future dates', () => {
    const dueDate = '2026-04-17';
    const today = new Date('2026-04-15T10:00:00Z');

    const days = calculateDaysUntilDue(dueDate, today, 'UTC');

    expect(days).toBe(2);
  });

  it('should return negative days for past dates', () => {
    const dueDate = '2026-04-13';
    const today = new Date('2026-04-15T10:00:00Z');

    const days = calculateDaysUntilDue(dueDate, today, 'UTC');

    expect(days).toBe(-2);
  });

  it('should handle timezone correctly', () => {
    // When it's April 15 midnight UTC, it's still April 14 in some timezones
    const dueDate = '2026-04-15';
    const utcMidnight = new Date('2026-04-15T00:00:00Z');

    // In UTC, should be 0 days
    expect(calculateDaysUntilDue(dueDate, utcMidnight, 'UTC')).toBe(0);
  });
});

describe('evaluateTask', () => {
  it('should create reminder when due in 2 days', () => {
    const task = createTask({ dueDate: '2026-04-17' });
    const today = new Date('2026-04-15T10:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateTask(task, today, defaultConfig, sentLog);

    expect(reminders.length).toBe(1);
    expect(reminders[0].reminderType).toBe('2-days-before');
    expect(reminders[0].daysUntilDue).toBe(2);
  });

  it('should create reminder when due tomorrow', () => {
    const task = createTask({ dueDate: '2026-04-16' });
    const today = new Date('2026-04-15T10:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateTask(task, today, defaultConfig, sentLog);

    expect(reminders.length).toBe(1);
    expect(reminders[0].reminderType).toBe('1-day-before');
  });

  it('should create reminder when due today', () => {
    const task = createTask({ dueDate: '2026-04-15' });
    const today = new Date('2026-04-15T10:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateTask(task, today, defaultConfig, sentLog);

    expect(reminders.length).toBe(1);
    expect(reminders[0].reminderType).toBe('due-today');
  });

  it('should create overdue reminder for recent past dates', () => {
    const task = createTask({ dueDate: '2026-04-13' });
    const today = new Date('2026-04-15T10:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateTask(task, today, defaultConfig, sentLog);

    expect(reminders.length).toBe(1);
    expect(reminders[0].reminderType).toBe('overdue');
    expect(reminders[0].daysUntilDue).toBe(-2);
  });

  it('should not create reminder for dates outside range', () => {
    const task = createTask({ dueDate: '2026-04-20' });
    const today = new Date('2026-04-15T10:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateTask(task, today, defaultConfig, sentLog);

    expect(reminders.length).toBe(0);
  });

  it('should not create reminder if already sent', () => {
    const task = createTask({ dueDate: '2026-04-15' });
    const today = new Date('2026-04-15T10:00:00Z');
    const sentLog = createEmptySentLog();

    // First evaluation creates reminder
    const firstReminders = evaluateTask(task, today, defaultConfig, sentLog);
    expect(firstReminders.length).toBe(1);

    // Add to sent log
    sentLog.reminders[firstReminders[0].key] = {
      sentAt: new Date().toISOString(),
      task: task.description,
      dueDate: task.dueDate!,
      reminderType: 'due-today',
      filePath: task.filePath,
    };

    // Second evaluation should not create reminder
    const secondReminders = evaluateTask(task, today, defaultConfig, sentLog);
    expect(secondReminders.length).toBe(0);
  });

  it('should handle scheduled dates when enabled', () => {
    const task = createTask({
      dueDate: null,
      scheduledDate: '2026-04-15',
    });
    const today = new Date('2026-04-15T10:00:00Z');
    const sentLog = createEmptySentLog();

    const configWithScheduled = { ...defaultConfig, includeScheduled: true };
    const reminders = evaluateTask(task, today, configWithScheduled, sentLog);

    expect(reminders.length).toBe(1);
  });

  it('should not remind for scheduled dates when disabled', () => {
    const task = createTask({
      dueDate: null,
      scheduledDate: '2026-04-15',
    });
    const today = new Date('2026-04-15T10:00:00Z');
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
    const today = new Date('2026-04-15T10:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateReminders(tasks, today, defaultConfig, sentLog);

    expect(reminders.length).toBe(1);
  });

  it('should sort reminders by urgency', () => {
    const tasks = [
      createTask({ description: 'Later', dueDate: '2026-04-17' }),
      createTask({ description: 'Today', dueDate: '2026-04-15' }),
      createTask({ description: 'Tomorrow', dueDate: '2026-04-16' }),
    ];
    const today = new Date('2026-04-15T10:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateReminders(tasks, today, defaultConfig, sentLog);

    expect(reminders.length).toBe(3);
    expect(reminders[0].task.description).toBe('Today');
    expect(reminders[1].task.description).toBe('Tomorrow');
    expect(reminders[2].task.description).toBe('Later');
  });
});

describe('groupRemindersByType', () => {
  it('should group reminders by type', () => {
    const tasks = [
      createTask({ description: 'Task 1', dueDate: '2026-04-15' }),
      createTask({ description: 'Task 2', dueDate: '2026-04-15' }),
      createTask({ description: 'Task 3', dueDate: '2026-04-16' }),
    ];
    const today = new Date('2026-04-15T10:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateReminders(tasks, today, defaultConfig, sentLog);
    const grouped = groupRemindersByType(reminders);

    expect(grouped.get('due-today')?.length).toBe(2);
    expect(grouped.get('1-day-before')?.length).toBe(1);
  });
});

describe('getReminderSummary', () => {
  it('should calculate summary correctly', () => {
    const tasks = [
      createTask({ description: 'Overdue', dueDate: '2026-04-13' }),
      createTask({ description: 'Today 1', dueDate: '2026-04-15' }),
      createTask({ description: 'Today 2', dueDate: '2026-04-15' }),
      createTask({ description: 'Tomorrow', dueDate: '2026-04-16' }),
      createTask({ description: 'Later', dueDate: '2026-04-17' }),
    ];
    const today = new Date('2026-04-15T10:00:00Z');
    const sentLog = createEmptySentLog();

    const reminders = evaluateReminders(tasks, today, defaultConfig, sentLog);
    const summary = getReminderSummary(reminders);

    expect(summary.total).toBe(5);
    expect(summary.overdue).toBe(1);
    expect(summary.dueToday).toBe(2);
    expect(summary.dueTomorrow).toBe(1);
    expect(summary.dueSoon).toBe(1);
  });
});
