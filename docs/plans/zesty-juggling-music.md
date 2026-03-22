# Plan: Rename `startTime` to `endTime`

## Context
The user wants to rename the Dataview inline field from `[startTime:: HH:mm]` to `[endTime:: HH:mm]` and update all corresponding code references. This is a pure rename — no logic changes.

## Files to modify

1. **`src/types.ts:25`** — Rename `startTime` field to `endTime` in `Task` interface, update comment
2. **`src/scanner.ts:36`** — Rename pattern key `startTime` → `endTime`, update regex to match `[endTime:: HH:mm]`
3. **`src/scanner.ts:125-155`** — Rename variable `startTime` → `endTime` in `parseTaskLine()`
4. **`src/reminder-engine.ts:31,34,37,47,51,76,133`** — Rename parameter/variable `startTime` → `endTime` in `buildDueDateTime()` and `calculateMinutesUntilDue()`, and update call sites in `evaluateTask()`
5. **`src/notifier.ts:67`** — `task.startTime` → `task.endTime`
6. **`src/bot-commands.ts:47,108`** — `task.startTime` → `task.endTime`
7. **`src/__tests__/reminder-engine.test.ts`** — All `startTime` references in test data and descriptions
8. **`src/__tests__/sent-log.test.ts:29`** — `startTime: null` → `endTime: null`

**Note:** `src/index.ts:39` and `src/scanner.ts:207` use a *local variable* named `startTime` for timing (unrelated to the Dataview field) — leave those as-is.

## Verification
1. Run `npx tsc --noEmit` — no type errors
2. Run `npm test` — all tests pass
3. Grep for `startTime` — only the unrelated timing variables in `index.ts` and `scanner.ts` should remain
