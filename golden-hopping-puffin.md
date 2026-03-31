# Plan: Convert obsidian-task-sync Template to Task Sync Plugin

## Context

The `obsidian-task-telegram-reminder` app currently scans the vault filesystem directly. We're splitting this into two parts: an Obsidian plugin that syncs tasks to MySQL, and a modified telegram app that reads from MySQL. This plan covers **Part 1 only** — the Obsidian plugin at `/root/01-projects/me/obsidian-task-sync`.

The template project is already scaffolded from the sample plugin with working build pipeline, settings system, and plugin lifecycle. We need to replace the sample content with task-sync logic.

---

## Files to Modify

### 1. `manifest.json`
- `id`: "sample-plugin" → "task-sync"
- `name`: "Sample Plugin" → "Task Sync"
- `description`: describe vault task scanning + MySQL sync
- `isDesktopOnly`: true (mysql2 needs Node.js/Electron)
- Update author info, remove fundingUrl

### 2. `package.json`
- `name`: "obsidian-sample-plugin" → "obsidian-task-sync"
- Add `"mysql2": "^3.11.0"` to dependencies
- Run `npm install` after

### 3. `esbuild.config.mjs` (line 20-34)
- Add `"mysql2"` to the `external` array (after "electron", before the @codemirror entries)
- This makes `require('mysql2/promise')` resolve at runtime from plugin's node_modules

---

## Files to Create

### 4. `src/types.ts` — Task & Priority types
Port only these from `/root/01-projects/me/obsidian-task-telegram-reminder/src/types.ts`:
- `Priority` type (line 8)
- `Task` interface (lines 13-38)

### 5. `src/task-parser.ts` — Pure parsing logic
Port from `/root/01-projects/me/obsidian-task-telegram-reminder/src/scanner.ts`:

**Constants** (lines 15-51):
- `TASK_LINE_REGEX` — extend to `/^(\s*[-*]|\d+\.)\s+\[([ xX/])\]\s+(.+)$/` (add `/` for in-progress)
- `DATE_PATTERNS`, `DATAVIEW_DATE_PATTERNS`, `PRIORITY_PATTERNS`, `RECURRENCE_REGEX`

**Functions** (lines 56-171):
- `extractDate`, `extractPriority`, `extractRecurrence`, `cleanDescription` (private)
- `parseTaskLine` (export) — `[/]` maps to `isDone: false`
- `shouldExclude` (export)

**Do NOT port**: `scanFile`, `scanVault`, `filterRelevantTasks` (fs/glob based)

### 6. `src/db.ts` — MySQL pool + vault_tasks table
- `createPool(settings)` → mysql2/promise Pool (connectionLimit: 3)
- `initTable(pool)` → CREATE TABLE IF NOT EXISTS vault_tasks (schema from plan doc)
- `syncTasks(pool, tasks)` → transaction: DELETE all → batch INSERT → return { inserted }
- `testConnection(pool)` → SELECT 1, return boolean

### 7. `src/settings.ts` — Complete rewrite
**TaskSyncSettings interface**:
- mysqlHost, mysqlPort, mysqlUser, mysqlPassword, mysqlDatabase
- syncIntervalMinutes (default 3), excludeFolders (default ".obsidian, .trash, templates, archive, archives")
- dataviewFormat (default true), includeScheduled (default true)

**TaskSyncSettingTab**: MySQL inputs (password field masked), "Test Connection" button, sync interval, exclude folders, toggles, "Sync Now" button

### 8. `src/main.ts` — Complete rewrite
**TaskSyncPlugin class**:
- `onload()`: load settings, add settings tab, ribbon icon (refresh-cw), command (sync-now), connect DB, schedule interval, initial sync
- `runSync()`: vault.getMarkdownFiles() → filter excluded → cachedRead → parseTaskLine per line → filter isDone===false → syncTasks → Notice
- `scheduleSyncInterval()`: registerInterval with configurable minutes
- `onunload()`: pool.end()
- `loadSettings()` / `saveSettings()`: same pattern as template

---

## Implementation Order

1. `src/types.ts` (no deps)
2. `src/task-parser.ts` (depends on types)
3. `src/db.ts` (depends on types, uses mysql2)
4. `manifest.json` + `package.json` + `esbuild.config.mjs` (independent config changes)
5. `src/settings.ts` (depends on db for test connection)
6. `src/main.ts` (depends on all above)
7. `npm install && npm run build`

---

## Verification

1. `npm run build` produces `main.js` without errors
2. TypeScript compilation succeeds with strict mode
3. No bundling of mysql2 (check main.js for `require("mysql2/promise")`)
