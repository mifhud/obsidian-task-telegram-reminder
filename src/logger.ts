/**
 * Logger module using Winston
 * Provides structured logging with configurable levels
 */

import winston from 'winston';
import type { AppConfig } from './types.js';

const { combine, timestamp, printf, colorize } = winston.format;

/**
 * Custom log format
 */
const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} [${level}] ${message}${metaStr}`;
});

/**
 * Creates a Winston logger instance
 */
export function createLogger(logLevel: AppConfig['logLevel'] = 'info'): winston.Logger {
  return winston.createLogger({
    level: logLevel,
    format: combine(
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      logFormat
    ),
    transports: [
      new winston.transports.Console({
        format: combine(
          colorize(),
          timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          logFormat
        ),
      }),
    ],
  });
}

// Default logger instance (will be replaced when config is loaded)
let logger = createLogger();

/**
 * Sets the global logger instance
 */
export function setLogger(newLogger: winston.Logger): void {
  logger = newLogger;
}

/**
 * Gets the current logger instance
 */
export function getLogger(): winston.Logger {
  return logger;
}

export default logger;
