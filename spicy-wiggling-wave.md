# Plan: Change reminder unit from days to minutes + add startTime field

## Context

The current system uses `reminderDays` (days before due date) to decide when to send reminders. Tasks only have date-level granularity. The user wants minute-level precision: reminders fire X minutes before a task's due datetime. A new `[startTime:: HH:mm]` Dataview field lets tasks specify an exact time on their due date. This enables time-aware reminders (e.g., "remind me 60 minutes before my 14:00 meeting").

## Changes

### 1. Config: rename `reminderDays` → `reminderMinutes` + add `overdueMinutes`

**File: `config.json`**
```json
{
  "reminderMinutes": [1440, 60, 0],
  "overdueMinutes": 10080
}
```
- `reminderMinutes: [1440, 60, 0]` → remind 1 day before, 1 hour before, and at the time
- `overdueMinutes: 10080` → send overdue reminders up to 7 days (7×24×60) after due time
- Remove `reminderDays`

**File: `src/types.ts`** — `AppConfig` interface
- `reminderDays: number[]` → `reminderMinutes: number[]`
- Add `overdueMinutes: number`

**File: `src/config.ts`** — defaults + validation
- Update default: `reminderMinutes: [1440, 60, 0]`
- Add default: `overdueMinutes: 10080`
- Remove old `reminderDays` validation

### 2. Parse `[startTime:: HH:mm]` from tasks

**File: `src/types.ts`** — `Task` interface
- Add `startTime: string | null` (HH:mm format)

**File: `src/scanner.ts`**
- Add regex: `DATAVIEW_TIME_PATTERNS.startTime = /\[startTime::\s*(\d{2}:\d{2})\]/`
- Also add emoji pattern: `⏰\s*(\d{2}:\d{2})` for non-dataview users
- Extract `startTime` in `parseTaskLine()`, add to returned Task
- Strip `[startTime:: ...]` in `cleanDescription()`

### 3. Rewrite reminder engine: days → minutes

**File: `src/reminder-engine.ts`**

Replace `calculateDaysUntilDue()` with `calculateMinutesUntilDue()`:
- Combine `dueDate` (YYYY-MM-DD) + `startTime` (HH:mm, default "00:00") into a full datetime
- Use `differenceInMinutes()` from date-fns instead of `differenceInDays()`
- Return minutes (positive = future, negative = past)

Update `evaluateTask()`:
- Use `config.reminderMinutes` instead of `config.reminderDays`
- Check: `minutesUntilDue` matches one of `reminderMinutes` values **with a tolerance window** (±half the scan interval, i.e. ±7.5 min for a 15-min cron) to handle the fact that scans don't run every minute
- Overdue check: `minutesUntilDue >= -config.overdueMinutes && minutesUntilDue < 0`

Update `getReminderType()`:
- `< 0` → `'overdue'`
- `0` (within tolerance) → `'due-now'`
- `> 0` → generate label dynamically based on minutes value

Update `Reminder` interface:
- `daysUntilDue: number` → `minutesUntilDue: number`

### 4. Update ReminderType and display

**File: `src/types.ts`**
- Change `ReminderType` to: `'overdue' | 'due-now' | 'upcoming'`
- Simplify since minute values are dynamic (no fixed "2-days-before" etc.)

**File: `src/notifier.ts`**
- Update `REMINDER_HEADERS` for new types
- For `'upcoming'`, include the minutes value in the header (e.g., "Reminder: due in 60 minutes")
- Update `formatSingleReminder()` to show time info when `startTime` is present

### 5. Update sent-log key generation

**File: `src/sent-log.ts`** — `generateReminderKey()`
- Change `reminderTypeId` to use minutes instead of days: `${minutesUntilDue}m` instead of `${daysUntilDue}d`
- This ensures each minute-threshold gets its own dedup key

### 6. Update tests

**File: `src/__tests__/reminder-engine.test.ts`**
- Update `defaultConfig` to use `reminderMinutes` and `overdueMinutes`
- Update all assertions from days to minutes
- Add tests for `startTime` parsing and minute-based evaluation
- Add tests for tolerance window logic

### 7. Tolerance window design

Since scans run every 15 minutes (`*/15 * * * *`), a reminder for "60 minutes before" might not hit exactly at 60 minutes. The engine should match when `minutesUntilDue` is within a window:
- For each value in `reminderMinutes`, check if `minutesUntilDue` falls in `[value - scanInterval/2, value + scanInterval/2)`
- The scan interval can be derived from `scanCron` or hardcoded as a config value. Simplest approach: add a tolerance derived from the cron (parse it) or use a reasonable default (e.g., 15 minutes).
- Simpler alternative: check `minutesUntilDue <= reminderMinuteValue` and use the sent-log to prevent re-sending. This way, if the scan runs and the task is ≤60 min away but the "60m" reminder hasn't been sent yet, send it.

**Recommended: threshold approach** — for each reminderMinutes value, trigger when `minutesUntilDue <= value` and that threshold's key hasn't been logged yet. This is simpler and more reliable than windowing.

## Files to modify

1. `config.json` — new field names/values
2. `src/types.ts` — `AppConfig`, `Task`, `Reminder`, `ReminderType`
3. `src/config.ts` — defaults, validation
4. `src/scanner.ts` — parse `[startTime:: HH:mm]`
5. `src/reminder-engine.ts` — core logic rewrite (days→minutes)
6. `src/sent-log.ts` — key generation update
7. `src/notifier.ts` — display updates for new types + startTime
8. `src/__tests__/reminder-engine.test.ts` — update tests

## Verification

1. `npm run build` — ensure TypeScript compiles
2. `npm test` — all tests pass
3. Manual dry-run test: create a task with `[startTime:: HH:mm]` set to ~60 min from now, run the scanner, verify it picks up the reminder
4. Check sent-reminders.json to confirm dedup keys use minute-based IDs
