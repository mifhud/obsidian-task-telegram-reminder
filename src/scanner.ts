/**
 * Vault Scanner module
 * Recursively walks the Obsidian vault and parses task lines from markdown files
 */

import { readFileSync, statSync } from 'fs';
import { globSync } from 'glob';
import { relative, join } from 'path';
import type { Task, Priority, ScanResult, AppConfig } from './types.js';

/**
 * Regex to match a markdown checkbox line
 * Captures: 1=list marker, 2=checkbox content (space/x/X), 3=rest of line
 */
const TASK_LINE_REGEX = /^(\s*[-*]|\d+\.)\s+\[([ xX])\]\s+(.+)$/;

/**
 * Regex patterns for extracting dates from task lines (emoji format)
 */
const DATE_PATTERNS = {
  due: /📅\s*(\d{4}-\d{2}-\d{2})/,
  scheduled: /⏳\s*(\d{4}-\d{2}-\d{2})/,
  start: /🛫\s*(\d{4}-\d{2}-\d{2})/,
  created: /➕\s*(\d{4}-\d{2}-\d{2})/,
  done: /✅\s*(\d{4}-\d{2}-\d{2})/,
};

/**
 * Regex patterns for Dataview format dates
 */
const DATAVIEW_DATE_PATTERNS = {
  due: /\[due::\s*(\d{4}-\d{2}-\d{2})\]/,
  scheduled: /\[scheduled::\s*(\d{4}-\d{2}-\d{2})\]/,
  start: /\[start::\s*(\d{4}-\d{2}-\d{2})\]/,
  created: /\[created::\s*(\d{4}-\d{2}-\d{2})\]/,
  endTime: /\[endTime::\s*(\d{2}:\d{2})\]/,
};

/**
 * Priority emoji patterns
 */
const PRIORITY_PATTERNS: Record<string, Priority> = {
  '⏫': 'high',
  '🔼': 'medium',
  '🔽': 'low',
};

/**
 * Recurrence pattern
 */
const RECURRENCE_REGEX = /🔁\s*([^\s📅⏳🛫➕✅⏫🔼🔽]+(?:\s+[^\s📅⏳🛫➕✅⏫🔼🔽]+)*)/;

/**
 * Extracts a date from a line using the given regex pattern
 */
function extractDate(line: string, pattern: RegExp): string | null {
  const match = line.match(pattern);
  return match ? match[1] : null;
}

/**
 * Extracts priority from a line
 */
function extractPriority(line: string): Priority {
  for (const [emoji, priority] of Object.entries(PRIORITY_PATTERNS)) {
    if (line.includes(emoji)) {
      return priority;
    }
  }
  return 'none';
}

/**
 * Extracts recurrence rule from a line
 */
function extractRecurrence(line: string): string | null {
  const match = line.match(RECURRENCE_REGEX);
  return match ? match[1].trim() : null;
}

/**
 * Strips all emoji markers, dates, and Dataview fields from description to get clean text
 */
function cleanDescription(description: string): string {
  return description
    // Remove emoji dates
    .replace(/[📅⏳🛫➕✅]\s*\d{4}-\d{2}-\d{2}/g, '')
    // Remove priority emojis
    .replace(/[⏫🔼🔽]/g, '')
    // Remove recurrence
    .replace(/🔁\s*[^\s📅⏳🛫➕✅⏫🔼🔽]+(?:\s+[^\s📅⏳🛫➕✅⏫🔼🔽]+)*/g, '')
    // Remove Dataview fields (including endTime)
    .replace(/\[\w+::\s*[^\]]+\]/g, '')
    // Clean up extra whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses a single task line into a Task object
 */
export function parseTaskLine(
  line: string,
  filePath: string,
  lineNumber: number,
  useDataview: boolean
): Task | null {
  const match = line.match(TASK_LINE_REGEX);
  if (!match) {
    return null;
  }

  const checkboxContent = match[2];
  const restOfLine = match[3];

  // Check if task is done
  const isDone = checkboxContent.toLowerCase() === 'x';

  // Extract dates (emoji format)
  let dueDate = extractDate(restOfLine, DATE_PATTERNS.due);
  let scheduledDate = extractDate(restOfLine, DATE_PATTERNS.scheduled);
  let startDate = extractDate(restOfLine, DATE_PATTERNS.start);
  let createdDate = extractDate(restOfLine, DATE_PATTERNS.created);

  // endTime is always parsed from Dataview format: [endTime:: HH:mm]
  const endTime = extractDate(restOfLine, DATAVIEW_DATE_PATTERNS.endTime);

  // Try Dataview format if enabled and emoji format not found
  if (useDataview) {
    if (!dueDate) {
      dueDate = extractDate(restOfLine, DATAVIEW_DATE_PATTERNS.due);
    }
    if (!scheduledDate) {
      scheduledDate = extractDate(restOfLine, DATAVIEW_DATE_PATTERNS.scheduled);
    }
    if (!startDate) {
      startDate = extractDate(restOfLine, DATAVIEW_DATE_PATTERNS.start);
    }
    if (!createdDate) {
      createdDate = extractDate(restOfLine, DATAVIEW_DATE_PATTERNS.created);
    }
  }

  // Extract other metadata
  const priority = extractPriority(restOfLine);
  const recurrence = extractRecurrence(restOfLine);
  const description = cleanDescription(restOfLine);

  return {
    description,
    dueDate,
    scheduledDate,
    startDate,
    createdDate,
    endTime,
    isDone,
    priority,
    filePath,
    lineNumber,
    rawLine: line,
    recurrence,
  };
}

/**
 * Checks if a file path should be excluded based on folder patterns
 */
function shouldExclude(filePath: string, excludeFolders: string[]): boolean {
  const pathParts = filePath.split('/');
  return excludeFolders.some((folder) => pathParts.includes(folder));
}

/**
 * Scans a single markdown file for tasks
 */
export function scanFile(
  absolutePath: string,
  relativePath: string,
  useDataview: boolean
): Task[] {
  const tasks: Task[] = [];

  try {
    const content = readFileSync(absolutePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const task = parseTaskLine(lines[i], relativePath, i + 1, useDataview);
      if (task) {
        tasks.push(task);
      }
    }
  } catch {
    // File read error - will be logged by caller
  }

  return tasks;
}

/**
 * Scans the entire vault for tasks
 */
export function scanVault(
  vaultPath: string,
  config: Pick<AppConfig, 'excludeFolders' | 'dataviewFormat'>
): ScanResult {
  const startTime = Date.now();
  const allTasks: Task[] = [];
  let filesScanned = 0;
  let filesSkipped = 0;

  // Find all markdown files
  const pattern = join(vaultPath, '**/*.md');
  const files = globSync(pattern, {
    nodir: true,
    absolute: true,
  });

  for (const absolutePath of files) {
    const relativePath = relative(vaultPath, absolutePath);

    // Check exclusions
    if (shouldExclude(relativePath, config.excludeFolders)) {
      continue;
    }

    // Check if file is readable
    try {
      const stats = statSync(absolutePath);
      if (!stats.isFile()) {
        continue;
      }
    } catch {
      filesSkipped++;
      continue;
    }

    const tasks = scanFile(absolutePath, relativePath, config.dataviewFormat);
    allTasks.push(...tasks);
    filesScanned++;
  }

  return {
    tasks: allTasks,
    filesScanned,
    filesSkipped,
    scanDurationMs: Date.now() - startTime,
  };
}

/**
 * Filters tasks to only include undone tasks with relevant dates
 */
export function filterRelevantTasks(
  tasks: Task[],
  includeScheduled: boolean
): Task[] {
  return tasks.filter((task) => {
    // Skip done tasks
    if (task.isDone) {
      return false;
    }

    // Must have a due date (or scheduled date if enabled)
    if (task.dueDate) {
      return true;
    }

    if (includeScheduled && task.scheduledDate) {
      return true;
    }

    return false;
  });
}
