/**
 * Unit tests for the scanner module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { parseTaskLine, scanFile, scanVault, filterRelevantTasks } from '../scanner.js';
import type { Task } from '../types.js';

// Test vault directory
const TEST_VAULT = join(process.cwd(), 'test-vault');

describe('parseTaskLine', () => {
  describe('basic task parsing', () => {
    it('should parse a simple task with due date', () => {
      const line = '- [ ] Buy groceries 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task).not.toBeNull();
      expect(task!.description).toBe('Buy groceries');
      expect(task!.dueDate).toBe('2026-04-15');
      expect(task!.isDone).toBe(false);
      expect(task!.priority).toBe('none');
    });

    it('should parse a completed task', () => {
      const line = '- [x] Completed task 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task).not.toBeNull();
      expect(task!.isDone).toBe(true);
    });

    it('should parse a task with uppercase X', () => {
      const line = '- [X] Completed task 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task).not.toBeNull();
      expect(task!.isDone).toBe(true);
    });

    it('should return null for non-task lines', () => {
      expect(parseTaskLine('Regular text', 'test.md', 1, false)).toBeNull();
      expect(parseTaskLine('# Heading', 'test.md', 1, false)).toBeNull();
      expect(parseTaskLine('- List item', 'test.md', 1, false)).toBeNull();
    });
  });

  describe('date extraction', () => {
    it('should extract due date', () => {
      const line = '- [ ] Task 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.dueDate).toBe('2026-04-15');
    });

    it('should extract scheduled date', () => {
      const line = '- [ ] Task ⏳ 2026-04-10';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.scheduledDate).toBe('2026-04-10');
    });

    it('should extract start date', () => {
      const line = '- [ ] Task 🛫 2026-04-01';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.startDate).toBe('2026-04-01');
    });

    it('should extract created date', () => {
      const line = '- [ ] Task ➕ 2026-03-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.createdDate).toBe('2026-03-15');
    });

    it('should handle multiple dates on one line', () => {
      const line = '- [ ] Task 🛫 2026-04-01 📅 2026-04-15 ⏳ 2026-04-10';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.dueDate).toBe('2026-04-15');
      expect(task!.scheduledDate).toBe('2026-04-10');
      expect(task!.startDate).toBe('2026-04-01');
    });

    it('should handle no dates', () => {
      const line = '- [ ] Task without dates';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.dueDate).toBeNull();
      expect(task!.scheduledDate).toBeNull();
    });
  });

  describe('priority extraction', () => {
    it('should extract high priority', () => {
      const line = '- [ ] Important task ⏫ 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.priority).toBe('high');
    });

    it('should extract medium priority', () => {
      const line = '- [ ] Normal task 🔼 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.priority).toBe('medium');
    });

    it('should extract low priority', () => {
      const line = '- [ ] Low priority task 🔽 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.priority).toBe('low');
    });

    it('should default to none if no priority', () => {
      const line = '- [ ] Task 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.priority).toBe('none');
    });
  });

  describe('list markers', () => {
    it('should parse task with hyphen marker', () => {
      const line = '- [ ] Task with hyphen 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task).not.toBeNull();
    });

    it('should parse task with asterisk marker', () => {
      const line = '* [ ] Task with asterisk 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task).not.toBeNull();
    });

    it('should parse task with numbered marker', () => {
      const line = '1. [ ] Task with number 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task).not.toBeNull();
    });

    it('should parse indented task', () => {
      const line = '    - [ ] Indented task 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task).not.toBeNull();
    });
  });

  describe('dataview format', () => {
    it('should parse dataview due date when enabled', () => {
      const line = '- [ ] Task [due:: 2026-04-15]';
      const task = parseTaskLine(line, 'test.md', 1, true);

      expect(task!.dueDate).toBe('2026-04-15');
    });

    it('should not parse dataview format when disabled', () => {
      const line = '- [ ] Task [due:: 2026-04-15]';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.dueDate).toBeNull();
    });

    it('should prefer emoji format over dataview', () => {
      const line = '- [ ] Task 📅 2026-04-20 [due:: 2026-04-15]';
      const task = parseTaskLine(line, 'test.md', 1, true);

      expect(task!.dueDate).toBe('2026-04-20');
    });
  });

  describe('description cleaning', () => {
    it('should strip emoji markers from description', () => {
      const line = '- [ ] Buy groceries 📅 2026-04-15 ⏫';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.description).toBe('Buy groceries');
    });

    it('should clean up extra whitespace', () => {
      const line = '- [ ] Task   with   spaces 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.description).toBe('Task with spaces');
    });

    it('should strip dataview fields', () => {
      const line = '- [ ] Task [due:: 2026-04-15] [priority:: high]';
      const task = parseTaskLine(line, 'test.md', 1, true);

      expect(task!.description).toBe('Task');
    });
  });

  describe('recurrence', () => {
    it('should extract recurrence rule', () => {
      const line = '- [ ] Weekly task 🔁 every week 📅 2026-04-15';
      const task = parseTaskLine(line, 'test.md', 1, false);

      expect(task!.recurrence).toBe('every week');
    });
  });
});

describe('scanVault', () => {
  beforeEach(() => {
    // Create test vault structure
    if (existsSync(TEST_VAULT)) {
      rmSync(TEST_VAULT, { recursive: true });
    }
    mkdirSync(TEST_VAULT, { recursive: true });
    mkdirSync(join(TEST_VAULT, 'notes'));
    mkdirSync(join(TEST_VAULT, '.obsidian'));
  });

  afterEach(() => {
    // Clean up
    if (existsSync(TEST_VAULT)) {
      rmSync(TEST_VAULT, { recursive: true });
    }
  });

  it('should scan markdown files in vault', () => {
    writeFileSync(
      join(TEST_VAULT, 'notes', 'tasks.md'),
      '- [ ] Task 1 📅 2026-04-15\n- [ ] Task 2 📅 2026-04-16'
    );

    const result = scanVault(TEST_VAULT, {
      excludeFolders: ['.obsidian'],
      dataviewFormat: false,
    });

    expect(result.tasks.length).toBe(2);
    expect(result.filesScanned).toBe(1);
  });

  it('should exclude configured folders', () => {
    writeFileSync(
      join(TEST_VAULT, 'notes', 'tasks.md'),
      '- [ ] Task 1 📅 2026-04-15'
    );
    writeFileSync(
      join(TEST_VAULT, '.obsidian', 'config.md'),
      '- [ ] Hidden task 📅 2026-04-15'
    );

    const result = scanVault(TEST_VAULT, {
      excludeFolders: ['.obsidian'],
      dataviewFormat: false,
    });

    expect(result.tasks.length).toBe(1);
  });

  it('should preserve file path and line number', () => {
    writeFileSync(
      join(TEST_VAULT, 'notes', 'tasks.md'),
      'Some text\n- [ ] Task 📅 2026-04-15\nMore text'
    );

    const result = scanVault(TEST_VAULT, {
      excludeFolders: [],
      dataviewFormat: false,
    });

    expect(result.tasks[0].filePath).toBe('notes/tasks.md');
    expect(result.tasks[0].lineNumber).toBe(2);
  });
});

describe('filterRelevantTasks', () => {
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
    rawLine: '- [ ] Test task',
    recurrence: null,
    ...overrides,
  });

  it('should filter out done tasks', () => {
    const tasks = [
      createTask({ isDone: false }),
      createTask({ isDone: true }),
    ];

    const filtered = filterRelevantTasks(tasks, false);

    expect(filtered.length).toBe(1);
    expect(filtered[0].isDone).toBe(false);
  });

  it('should filter out tasks without due dates', () => {
    const tasks = [
      createTask({ dueDate: '2026-04-15' }),
      createTask({ dueDate: null }),
    ];

    const filtered = filterRelevantTasks(tasks, false);

    expect(filtered.length).toBe(1);
  });

  it('should include tasks with scheduled dates when enabled', () => {
    const tasks = [
      createTask({ dueDate: null, scheduledDate: '2026-04-15' }),
    ];

    const filteredWithScheduled = filterRelevantTasks(tasks, true);
    const filteredWithoutScheduled = filterRelevantTasks(tasks, false);

    expect(filteredWithScheduled.length).toBe(1);
    expect(filteredWithoutScheduled.length).toBe(0);
  });
});
