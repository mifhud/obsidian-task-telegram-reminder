# Plan: Extract Vault Scanning to Obsidian Plugin

## Context

The current `obsidian-task-telegram-reminder` app (on `mysql` branch) is a standalone Node.js service that directly reads markdown files from the Obsidian vault filesystem using `glob`/`fs`. This creates a tight coupling to the filesystem and requires `VAULT_PATH` configuration.

**Goal**: Split into two parts:
1. **New Obsidian plugin** — scans the vault using the Obsidian API, writes tasks to a `vault_tasks` MySQL table on a schedule
2. **Modified telegram reminder app** — reads tasks from `vault_tasks` instead of scanning the filesystem

This decouples the vault access from the reminder service and moves scanning into Obsidian itself.

---

## Part 1: New Obsidian Plugin

**Location**: `/root/01-projects/me/obsidian-task-sync` (new project, scaffolded from `/root/01-projects/me/obsidian-sample-plugin`)

**Sync scope**: Only undone `[ ]` and in-progress `[/]` tasks are synced. Done `[x]`/`[X]` tasks are excluded.

### Files to Create

```
obsidian-task-sync/
  manifest.json          # Plugin metadata (id: "task-sync", isDesktopOnly: true)
  package.json           # Dependencies: obsidian, mysql2
  tsconfig.json          # From sample plugin
  esbuild.config.mjs     # From sample plugin, with mysql2 as external
  .gitignore
  src/
    main.ts              # Plugin class, lifecycle, scheduling, vault reading
    settings.ts          # Settings interface + PluginSettingTab
    task-parser.ts       # Ported from scanner.ts (pure parsing, no fs)
    types.ts             # Task/Priority types (from existing types.ts)
    db.ts                # MySQL pool, table init, syncTasks
```

### Settings (`src/settings.ts`)

```typescript
interface TaskSyncSettings {
  mysqlHost: string;         // default: "localhost"
  mysqlPort: number;         // default: 3306
  mysqlUser: string;         // default: ""
  mysqlPassword: string;     // default: ""
  mysqlDatabase: string;     // default: ""
  syncIntervalMinutes: number; // default: 3
  excludeFolders: string;    // default: ".obsidian, .trash, templates, archive, archives"
  dataviewFormat: boolean;   // default: true
  includeScheduled: boolean; // default: true
}
```

Settings tab with text inputs for MySQL connection, interval, exclude folders, and toggles for dataview/scheduled. Include a "Test Connection" button and a "Sync Now" button.

### Task Parser (`src/task-parser.ts`)

Port pure functions from `/root/01-projects/me/obsidian-task-telegram-reminder/src/scanner.ts`:
- Constants: `TASK_LINE_REGEX`, `DATE_PATTERNS`, `DATAVIEW_DATE_PATTERNS`, `PRIORITY_PATTERNS`, `RECURRENCE_REGEX`
- Functions: `extractDate`, `extractPriority`, `extractRecurrence`, `cleanDescription`, `parseTaskLine`, `shouldExclude`

**Extend task status handling**: Current regex captures `[ xX]` in checkbox. Extend to also capture `[/]` (in-progress). Update `TASK_LINE_REGEX` to `/^(\s*[-*]|\d+\.)\s+\[([ xX/])\]\s+(.+)$/`. Map `[/]` to `isDone: false` (it's in-progress, should still be synced/reminded).

**Filtering in sync**: Only sync tasks where `isDone === false` (i.e., `[ ]` and `[/]`). Skip `[x]`/`[X]` tasks.

Do NOT port: `scanFile`, `scanVault`, `filterRelevantTasks` (these use `fs`/`glob`; vault reading uses Obsidian API instead)

### Database (`src/db.ts`)

**`vault_tasks` table schema:**
```sql
CREATE TABLE IF NOT EXISTS vault_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_path VARCHAR(1024) NOT NULL,
  line_number INT NOT NULL,
  raw_line TEXT NOT NULL,
  description TEXT NOT NULL,
  is_done TINYINT(1) NOT NULL DEFAULT 0,
  due_date DATE NULL,
  scheduled_date DATE NULL,
  start_date DATE NULL,
  created_date DATE NULL,
  end_time VARCHAR(5) NULL,
  priority ENUM('high','medium','low','none') NOT NULL DEFAULT 'none',
  recurrence VARCHAR(255) NULL,
  synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_file_line (file_path(500), line_number),
  INDEX idx_due_date (due_date),
  INDEX idx_scheduled_date (scheduled_date)
);
```

**Sync strategy**: Full replace in a transaction — `DELETE FROM vault_tasks` then batch `INSERT`. Simple, consistent, and the dataset is small. InnoDB REPEATABLE READ isolation ensures the telegram app never sees an empty table mid-sync.

Functions:
- `createPool(settings) -> Pool`
- `initTable(pool) -> void`
- `syncTasks(pool, tasks: Task[]) -> { inserted: number }`
- `testConnection(pool) -> boolean`

### Main Plugin (`src/main.ts`)

```typescript
export default class TaskSyncPlugin extends Plugin {
  settings: TaskSyncSettings;
  pool: Pool | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new TaskSyncSettingTab(this.app, this));
    this.addRibbonIcon('refresh-cw', 'Sync tasks to MySQL', () => this.runSync());
    this.addCommand({ id: 'sync-now', name: 'Sync tasks to MySQL now', callback: () => this.runSync() });
    await this.connectDb();
    this.scheduleSyncInterval();
    await this.runSync();  // initial sync
  }

  async onunload() {
    if (this.pool) await this.pool.end();
  }

  async runSync() {
    // 1. this.app.vault.getMarkdownFiles() — get all md files
    // 2. Filter excluded folders using shouldExclude(file.path, excludeFolders)
    // 3. For each file: await this.app.vault.cachedRead(file), split lines, parseTaskLine()
    // 4. Filter: only keep tasks where isDone === false ([ ] and [/], not [x])
    // 5. syncTasks(this.pool, filteredTasks)
    // 6. new Notice(`Synced ${n} tasks`)
  }

  scheduleSyncInterval() {
    const ms = this.settings.syncIntervalMinutes * 60 * 1000;
    this.registerInterval(window.setInterval(() => this.runSync(), ms));
  }
}
```

### esbuild Config

Copy from sample plugin. Add `mysql2` and `mysql2/promise` to the `external` array. Since Obsidian runs in Electron with full Node.js access, `require('mysql2/promise')` resolves from the plugin's `node_modules` at runtime. The plugin directory must include `node_modules/mysql2` when installed.

---

## Part 2: Modify Telegram Reminder App

Working in `/root/01-projects/me/obsidian-task-telegram-reminder` on the `mysql` branch.

### New file: `src/task-reader.ts`

Reads tasks from the `vault_tasks` MySQL table:

```typescript
export async function readTasksFromDb(pool: Pool, includeScheduled: boolean): Promise<Task[]> {
  // SELECT * FROM vault_tasks WHERE is_done = 0 AND (due_date IS NOT NULL [OR scheduled_date IS NOT NULL])
  // Map rows to Task objects
}
```

### Modify: `src/index.ts`

**`runScanCycle()`** (line 41-121):
- Replace `scanVault(config.vaultPath, config)` + `filterRelevantTasks(...)` with `readTasksFromDb(getPool(), config.includeScheduled)`
- Remove import of `scanVault`, `filterRelevantTasks` from `scanner.js`
- Add import of `readTasksFromDb` from `task-reader.js`
- Update logging (no more filesScanned/filesSkipped/scanDurationMs)

**`main()`** (line 161-249):
- Remove `vaultPath` from startup log (line 178)

### Modify: `src/bot-commands.ts`

Both `/status` (line 37) and `/upcoming` (line 101) call `scanVault` directly. Replace with `readTasksFromDb`:
- Remove import of `scanVault`, `filterRelevantTasks` from `scanner.js`
- Add import of `readTasksFromDb` from `task-reader.js`
- Replace `scanVault(config.vaultPath, config)` + `filterRelevantTasks(...)` with `await readTasksFromDb(getPool(), config.includeScheduled)`

### Modify: `src/config.ts`

- Remove `VAULT_PATH` from `loadEnvConfig()` (lines 127, 130-133, 141)
- Remove `validatePath` call for vault path

### Modify: `src/types.ts`

- Remove `vaultPath` from `EnvConfig` interface (line 143)
- Remove `ScanResult` interface (lines 156-166) — no longer needed
- Remove `excludeFolders` and `dataviewFormat` from `AppConfig` interface (plugin-only now)

### Modify: `config.json`

- Remove `excludeFolders` and `dataviewFormat` keys (these are now plugin-only settings)

### Modify: `src/database.ts`

Add `vault_tasks` table creation to `initDatabase()` alongside `sent_reminders`. Defense in depth — the plugin creates it too, but the app should be able to initialize it.

### Delete: `src/scanner.ts`

No longer needed — logic is in the plugin now.

### Modify: `package.json`

Remove `glob` dependency.

### Modify: `.env.example`

Remove `VAULT_PATH`.

### Modify: `config.json`

Remove `excludeFolders`, `dataviewFormat`, `includeScheduled` if they are now purely plugin settings. **Keep** `includeScheduled` in the app config since it affects which tasks are queried from the DB. Remove `excludeFolders` and `dataviewFormat` (these are scanning concerns, now handled by the plugin).

---

## Implementation Order

1. Create new plugin project (scaffold from sample plugin)
2. Port `task-parser.ts` and `types.ts` to the plugin
3. Implement `db.ts` (pool, table creation, syncTasks)
4. Implement `settings.ts` (settings interface, tab UI)
5. Implement `main.ts` (vault reading via Obsidian API, scheduling)
6. Configure esbuild for mysql2
7. Create `src/task-reader.ts` in the telegram app
8. Modify `index.ts` to use task-reader
9. Modify `bot-commands.ts` to use task-reader
10. Modify `config.ts` and `types.ts` (remove vaultPath)
11. Modify `database.ts` (add vault_tasks table)
12. Delete `scanner.ts`, clean up dependencies and config
13. Update existing tests / add new tests

## Verification

1. Build the plugin: `npm run build` produces `main.js`
2. Install plugin in test Obsidian vault, configure MySQL, trigger sync
3. Query `vault_tasks` table directly — verify tasks are present
4. Run telegram reminder app — verify reminders evaluated correctly from DB
5. Run existing tests (update mocks as needed)
6. Test bot commands `/status` and `/upcoming` — verify they read from DB
