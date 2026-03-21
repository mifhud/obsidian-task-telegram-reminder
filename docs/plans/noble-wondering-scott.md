# Plan: Add 15min reminder threshold & convert overdueMinutes to array

## Context
User wants to add a 15-minute reminder threshold to `reminderMinutes` and convert `overdueMinutes` from a single number to an array with two thresholds: 1 day (1440 min) and 3 days (4320 min). This enables multiple overdue reminder notifications at different intervals, matching how `reminderMinutes` already works.

## Changes

### 1. `src/types.ts` (line 96)
Change `overdueMinutes: number` → `overdueMinutes: number[]`

### 2. `config.json` (lines 3-4)
- `reminderMinutes`: `[1440, 60, 0]` → `[1440, 60, 15, 0]`
- `overdueMinutes`: `10080` → `[4320, 1440]`

### 3. `src/config.ts` (lines 16-17, 142-144)
- Update `DEFAULT_CONFIG`: `reminderMinutes: [1440, 60, 15, 0]`, `overdueMinutes: [4320, 1440]`
- Update validation: check `Array.isArray(config.overdueMinutes)` instead of `typeof ... !== 'number'`

### 4. `src/sent-log.ts` (lines 81-82)
Update key format so different overdue thresholds produce different keys:
- `thresholdMinutes < 0 ? 'overdue' : ...` → `thresholdMinutes < 0 ? `overdue-${Math.abs(thresholdMinutes)}m` : ...`

### 5. `src/reminder-engine.ts` (lines 103-122)
Replace single overdue check with loop over `config.overdueMinutes` array:
- Iterate each threshold, fire if `overdueMinutes >= threshold`
- Use `-threshold` as `thresholdMinutes` (negative to distinguish from upcoming)
- Each threshold gets its own dedup key

### 6. `src/notifier.ts` (line 25) — no change needed
The overdue header stays generic "OVERDUE". The message body already shows actual overdue duration.

### 7. Tests
- `src/__tests__/reminder-engine.test.ts`: Update `defaultConfig.overdueMinutes` to array, update overdue test expectations for threshold-based behavior, add test for multiple overdue thresholds firing
- `src/__tests__/sent-log.test.ts`: Update overdue key format expectations

## Verification
1. `npm run build` — TypeScript compiles cleanly
2. `npm test` — all tests pass
3. Manual: verify a task 2 days overdue fires `1440` threshold but not `4320`
