/**
 * Configuration loader module
 * Loads and validates configuration from .env and config.json
 */

import { config as dotenvConfig } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Config, AppConfig, EnvConfig } from './types.js';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: AppConfig = {
  scanCron: '0 8 * * *',
  reminderMinutes: [1440, 60, 15, 0],
  overdueMinutes: [4320, 1440],
  excludeFolders: ['.obsidian', '.trash', 'templates', 'archive', 'archives'],
  includeScheduled: false,
  dataviewFormat: false,
  sentLogPath: './sent-reminders.json',
  timezone: 'Asia/Jakarta',
  logLevel: 'info',
};

/**
 * Validates that a required environment variable is present
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Validates that a path exists on the filesystem
 */
function validatePath(path: string, description: string): void {
  if (!existsSync(path)) {
    throw new Error(`${description} does not exist: ${path}`);
  }
}

/**
 * Validates a cron expression (basic validation)
 */
function validateCron(cron: string, field: string): void {
  const parts = cron.split(' ');
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression for ${field}: "${cron}". Expected 5 fields (minute hour day month weekday).`
    );
  }
}

/**
 * Validates time format (HH:mm)
 */
function validateTime(time: string, field: string): void {
  const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    throw new Error(
      `Invalid time format for ${field}: "${time}". Expected HH:mm (24-hour format).`
    );
  }
}

/**
 * Validates log level
 */
function validateLogLevel(
  level: string
): asserts level is 'debug' | 'info' | 'warn' | 'error' {
  const validLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLevels.includes(level)) {
    throw new Error(
      `Invalid log level: "${level}". Expected one of: ${validLevels.join(', ')}`
    );
  }
}

/**
 * Loads environment variables from .env file
 */
function loadEnvConfig(): EnvConfig {
  // Load .env file
  dotenvConfig();

  const telegramBotToken = requireEnv('TELEGRAM_BOT_TOKEN');
  const telegramChatId = requireEnv('TELEGRAM_CHAT_ID');
  const vaultPath = requireEnv('VAULT_PATH');

  // Resolve vault path to absolute
  const resolvedVaultPath = resolve(vaultPath);

  // Validate vault path exists
  validatePath(resolvedVaultPath, 'Vault path');

  return {
    telegramBotToken,
    telegramChatId,
    vaultPath: resolvedVaultPath,
  };
}

/**
 * Loads application config from config.json
 */
function loadAppConfig(configPath: string = './config.json'): AppConfig {
  const resolvedPath = resolve(configPath);

  if (!existsSync(resolvedPath)) {
    console.log(`Config file not found at ${resolvedPath}, using defaults.`);
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = readFileSync(resolvedPath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<AppConfig>;

    // Merge with defaults
    const config: AppConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
    };

    // Validate
    validateCron(config.scanCron, 'scanCron');
    validateLogLevel(config.logLevel);

    if (!Array.isArray(config.reminderMinutes)) {
      throw new Error('reminderMinutes must be an array of numbers');
    }

    if (!Array.isArray(config.overdueMinutes)) {
      throw new Error('overdueMinutes must be an array of numbers');
    }

    if (!Array.isArray(config.excludeFolders)) {
      throw new Error('excludeFolders must be an array of strings');
    }

    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Loads the complete configuration
 */
export function loadConfig(configPath?: string): Config {
  const envConfig = loadEnvConfig();
  const appConfig = loadAppConfig(configPath);

  return {
    ...envConfig,
    ...appConfig,
  };
}

/**
 * Loads config without validation (for dry-run or testing)
 */
export function loadConfigSafe(configPath?: string): Config | null {
  try {
    return loadConfig(configPath);
  } catch (error) {
    console.error('Failed to load configuration:', error);
    return null;
  }
}

export { DEFAULT_CONFIG };
