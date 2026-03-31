/**
 * Task reader module
 * Reads tasks from the vault_tasks MySQL table (written by the Obsidian plugin)
 */

import type { Pool } from 'mysql2/promise';
import type { Task, Priority } from './types.js';

interface VaultTaskRow {
  id: number;
  file_path: string;
  line_number: number;
  raw_line: string;
  description: string;
  is_done: number;
  due_date: string | null;
  scheduled_date: string | null;
  start_date: string | null;
  created_date: string | null;
  end_time: string | null;
  priority: Priority;
  recurrence: string | null;
}

function formatDate(value: string | Date | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.substring(0, 10);
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return null;
}

/**
 * Reads undone tasks from the vault_tasks table.
 * When includeScheduled is true, includes tasks that have a scheduled date but no due date.
 */
export async function readTasksFromDb(
  pool: Pool,
  includeScheduled: boolean
): Promise<Task[]> {
  let sql: string;

  if (includeScheduled) {
    sql = `
      SELECT * FROM vault_tasks
      WHERE is_done = 0
        AND (due_date IS NOT NULL OR scheduled_date IS NOT NULL)
    `;
  } else {
    sql = `
      SELECT * FROM vault_tasks
      WHERE is_done = 0
        AND due_date IS NOT NULL
    `;
  }

  const [rows] = await pool.execute(sql);
  return (rows as VaultTaskRow[]).map((row) => ({
    description: row.description,
    dueDate: formatDate(row.due_date),
    scheduledDate: formatDate(row.scheduled_date),
    startDate: formatDate(row.start_date),
    createdDate: formatDate(row.created_date),
    endTime: row.end_time ?? null,
    isDone: row.is_done === 1,
    priority: row.priority,
    filePath: row.file_path,
    lineNumber: row.line_number,
    rawLine: row.raw_line,
    recurrence: row.recurrence ?? null,
  }));
}
