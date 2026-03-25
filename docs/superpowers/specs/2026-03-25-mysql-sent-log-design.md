# MySQL Sent Log Migration Design

**Date:** 2026-03-25  
**Status:** Approved  

## Overview

Replace the JSON file-based sent reminders log (`sent-reminders.json`) with a MySQL database backend using the `mysql2` package.

## Requirements

- Dedicated MySQL database for the reminder service
- MySQL is required (no JSON fallback)
- Start fresh (no data migration from existing JSON)
- Connection options configurable via environment variables (JSON format)
- Support for options like `ssl: false`

## Configuration

### Environment Variables

```env
# MySQL Database Configuration  
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=reminder_user
MYSQL_PASSWORD=your_secure_password
MYSQL_DATABASE=obsidian_reminder
MYSQL_OPTIONS={"ssl":false}
```

### Config.json Changes

Remove `sentLogPath` from config.json (line 8).

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS sent_reminders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reminder_key VARCHAR(512) NOT NULL UNIQUE,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  task_description TEXT NOT NULL,
  due_date DATE NOT NULL,
  reminder_type ENUM('overdue', 'due-now', 'upcoming') NOT NULL,
  file_path VARCHAR(1024) NOT NULL,
  INDEX idx_sent_at (sent_at),
  INDEX idx_due_date (due_date)
);
```

## Implementation

### New Files

1. **`src/database.ts`** - MySQL connection pool management
2. **`src/sent-log-mysql.ts`** - MySQL-backed sent log functions
3. **`src/__tests__/sent-log-mysql.test.ts`** - Mocked unit tests

### Modified Files

1. **`src/types.ts`** - Add MySqlConfig, remove sentLogPath
2. **`src/config.ts`** - Add loadMysqlConfig(), remove sentLogPath
3. **`src/index.ts`** - Use MySQL sent-log module
4. **`config.json`** - Remove sentLogPath line
5. **`.env.example`** - Add MySQL env vars
6. **`docker-compose.yml`** - Add MySQL env vars
7. **`package.json`** - Add mysql2 dependency

### Dependencies

Add to package.json:
```json
"mysql2": "^3.11.0"
```

## Error Handling

- **Startup**: Connection failure → exit(1)
- **Runtime**: Query failures logged, scan continues
- **Shutdown**: Pool closed gracefully

## Testing

Use vitest with mocked mysql2 for unit tests (no real database required).
