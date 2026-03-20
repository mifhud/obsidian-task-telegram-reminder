/**
 * Scheduler module
 * Manages cron-based scheduling of vault scans and reminder checks
 */

import cron, { ScheduledTask } from 'node-cron';
import type { Config } from './types.js';

export interface SchedulerOptions {
  /** Primary scan cron expression */
  scanCron: string;
  /** Optional evening scan cron expression */
  eveningScanCron: string | null;
  /** Timezone for scheduling */
  timezone: string;
}

export interface Scheduler {
  /** Primary scan task */
  primaryTask: ScheduledTask;
  /** Optional evening scan task */
  eveningTask: ScheduledTask | null;
  /** Stop all scheduled tasks */
  stop: () => void;
}

/**
 * Creates and starts the scheduler
 */
export function createScheduler(
  options: SchedulerOptions,
  onScan: () => Promise<void>
): Scheduler {
  const { scanCron, eveningScanCron, timezone } = options;

  // Validate cron expressions
  if (!cron.validate(scanCron)) {
    throw new Error(`Invalid cron expression for scanCron: ${scanCron}`);
  }

  if (eveningScanCron && !cron.validate(eveningScanCron)) {
    throw new Error(
      `Invalid cron expression for eveningScanCron: ${eveningScanCron}`
    );
  }

  // Create primary scan task
  const primaryTask = cron.schedule(
    scanCron,
    async () => {
      console.log(`[${new Date().toISOString()}] Running scheduled scan...`);
      try {
        await onScan();
      } catch (error) {
        console.error('Scan failed:', error);
      }
    },
    {
      timezone,
      scheduled: true,
    }
  );

  // Create optional evening scan task
  let eveningTask: ScheduledTask | null = null;
  if (eveningScanCron) {
    eveningTask = cron.schedule(
      eveningScanCron,
      async () => {
        console.log(
          `[${new Date().toISOString()}] Running evening scheduled scan...`
        );
        try {
          await onScan();
        } catch (error) {
          console.error('Evening scan failed:', error);
        }
      },
      {
        timezone,
        scheduled: true,
      }
    );
  }

  const stop = () => {
    primaryTask.stop();
    if (eveningTask) {
      eveningTask.stop();
    }
  };

  return {
    primaryTask,
    eveningTask,
    stop,
  };
}

/**
 * Creates scheduler from config
 */
export function createSchedulerFromConfig(
  config: Config,
  onScan: () => Promise<void>
): Scheduler {
  return createScheduler(
    {
      scanCron: config.scanCron,
      eveningScanCron: config.eveningScanCron,
      timezone: config.timezone,
    },
    onScan
  );
}

/**
 * Parses a cron expression and returns human-readable description
 */
export function describeCron(cronExpr: string): string {
  const parts = cronExpr.split(' ');
  if (parts.length !== 5) {
    return 'Invalid cron expression';
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Handle common patterns
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    // Daily
    if (minute === '0' && hour !== '*') {
      return `Daily at ${hour}:00`;
    }
    if (minute !== '*' && hour !== '*') {
      return `Daily at ${hour}:${minute.padStart(2, '0')}`;
    }
  }

  // Fallback to raw expression
  return `Cron: ${cronExpr}`;
}

/**
 * Gets the next scheduled run time
 */
export function getNextRun(task: ScheduledTask): Date | null {
  // node-cron doesn't expose next run time directly
  // This is a placeholder - in production, you might use a library
  // like cron-parser to calculate the next run
  return null;
}
