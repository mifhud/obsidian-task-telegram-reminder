# Obsidian Tasks → Telegram Reminder System

## Implementation Plan

---

## 1. Project Overview

A standalone Node.js background process that monitors an existing Obsidian vault for tasks with due dates, then sends Telegram reminders at three intervals: 2 days before, 1 day before, and on the due date itself.

**Key design decisions drawn from studying the reference repositories:**

- **Task format** follows the Obsidian Tasks plugin emoji convention (the de facto standard with 3.5k+ GitHub stars), meaning tasks look like `- [ ] Buy groceries 📅 2026-04-15`
- **Scanning pattern** is inspired by the `obsidian_gchat_plugin`, which polls all vault notes on a fixed interval — but adapted here to run outside of Obsidian as a standalone daemon, reading `.md` files directly from disk
- **Notification delivery** uses the Telegram Bot API instead of Google Chat webhooks, via the `node-telegram-bot-api` package

---

## 2. Obsidian Tasks Format Reference

The Obsidian Tasks plugin uses emoji markers inline within standard Markdown checkbox lines. The scanner must understand this format to extract due dates reliably.

### 2.1 Task Line Structure

```
- [ ] <description> [<emoji> <date>]... [✅ <done-date>]
- [x] <description> [<emoji> <date>]... [✅ <done-date>]
```

Supported list markers: `- [ ]`, `* [ ]`, `1. [ ]` (with optional indentation).

### 2.2 Emoji → Date Type Mapping

| Emoji | Meaning        | Format       | Relevant to Reminders? |
|-------|----------------|--------------|------------------------|
| 📅    | Due date       | `YYYY-MM-DD` | **Yes — primary trigger** |
| ⏳    | Scheduled date | `YYYY-MM-DD` | Optional (secondary)   |
| 🛫    | Start date     | `YYYY-MM-DD` | No                     |
| ➕    | Created date   | `YYYY-MM-DD` | No                     |
| ✅    | Done date      | `YYYY-MM-DD` | No (skip done tasks)   |
| 🔁    | Recurrence     | text rule    | Awareness only         |

### 2.3 Priority Markers (for message enrichment)

| Emoji | Priority |
|-------|----------|
| ⏫    | High     |
| 🔼    | Medium   |
| 🔽    | Low      |

### 2.4 Dataview Format (optional support)

Some users use Dataview inline fields instead of emojis:

```
- [ ] Task description [due:: 2026-04-15] [priority:: high]
```

The parser should optionally support this as a secondary format.

### 2.5 Status Detection

A task is **not done** when the checkbox content is a space: `- [ ]`.
A task is **done** when marked `- [x]` or `- [X]`, or contains a `✅` done date.
The scanner should **only process not-done tasks**.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────┐
│                 Node.js Process                   │
│                                                   │
│  ┌─────────────┐   ┌───────────────────────────┐ │
│  │  Scheduler   │──▶│  Vault Scanner            │ │
│  │  (node-cron) │   │  - Walks .md files        │ │
│  └─────────────┘   │  - Parses task lines       │ │
│                     │  - Extracts due dates      │ │
│                     └──────────┬────────────────┘ │
│                                │                   │
│                     ┌──────────▼────────────────┐ │
│                     │  Reminder Engine           │ │
│                     │  - Compares dates to today │ │
│                     │  - Checks sent-log (JSON)  │ │
│                     │  - Determines what to send │ │
│                     └──────────┬────────────────┘ │
│                                │                   │
│                     ┌──────────▼────────────────┐ │
│                     │  Telegram Notifier         │ │
│                     │  - Formats message         │ │
│                     │  - Sends via Bot API       │ │
│                     └───────────────────────────┘ │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │  Sent Log (sent-reminders.json)             │  │
│  │  Prevents duplicate notifications           │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │  Config (.env + config.json)                │  │
│  │  Vault path, bot token, chat ID, schedule   │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### 3.1 Why This Architecture

- **No database needed** — A simple JSON file tracks which reminders have been sent. Tasks are re-parsed from disk each cycle, which is the simplest approach and handles edits/deletions naturally.
- **No file watchers** — The gchat plugin uses interval-based polling (every 3 minutes), and this works well for reminders too. File watchers (chokidar) add complexity and are unnecessary for daily-resolution checks.
- **Stateless parsing** — Each scan cycle reads the entire vault fresh. This means if a user changes a due date, the next scan picks it up automatically with no stale-state bugs.

---

## 4. Module Breakdown

### 4.1 `config.ts` — Configuration Loader

**Responsibilities:** Load and validate all configuration from `.env` and an optional `config.json`.

**Configuration values:**

| Key | Source | Description | Default |
|-----|--------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | `.env` | Token from BotFather | *required* |
| `TELEGRAM_CHAT_ID` | `.env` | Target chat/user ID | *required* |
| `VAULT_PATH` | `.env` | Absolute path to Obsidian vault | *required* |
| `SCAN_CRON` | `config.json` | Cron expression for scan frequency | `0 8 * * *` (daily 8 AM) |
| `REMINDER_DAYS` | `config.json` | Days before due date to remind | `[2, 1, 0]` |
| `REMINDER_TIME` | `config.json` | Time of day to send (HH:mm) | `08:00` |
| `EXCLUDE_FOLDERS` | `config.json` | Vault folders to skip | `[".obsidian", ".trash"]` |
| `INCLUDE_SCHEDULED` | `config.json` | Also remind on ⏳ scheduled dates | `false` |
| `DATAVIEW_FORMAT` | `config.json` | Also parse `[due:: date]` syntax | `false` |
| `SENT_LOG_PATH` | `config.json` | Path to sent-reminders JSON file | `./sent-reminders.json` |
| `TIMEZONE` | `config.json` | IANA timezone string | `Asia/Jakarta` |
| `LOG_LEVEL` | `config.json` | Logging verbosity | `info` |

**Validation rules:** The loader should fail fast with clear error messages if required values are missing or if `VAULT_PATH` doesn't exist.

### 4.2 `scanner.ts` — Vault Scanner

**Responsibilities:** Recursively walk the vault directory, read all `.md` files, and extract task objects.

**Algorithm:**

1. Recursively glob `VAULT_PATH/**/*.md`, excluding configured folders
2. For each file, read contents as UTF-8
3. Split into lines, filter for lines matching the task regex
4. For each matching line, parse into a `Task` object

**Task regex pattern (emoji format):**

```
/^(\s*[-*]|\d+\.)\s+\[([ xX])\]\s+(.+)$/
```

This matches any Markdown checkbox line. Then from the captured description (`$3`), extract dates:

```
/📅\s*(\d{4}-\d{2}-\d{2})/    → due date
/⏳\s*(\d{4}-\d{2}-\d{2})/    → scheduled date
/🛫\s*(\d{4}-\d{2}-\d{2})/    → start date
/✅\s*(\d{4}-\d{2}-\d{2})/    → done date
/[⏫🔼🔽]/                     → priority
```

**Optional Dataview regex:**

```
/\[due::\s*(\d{4}-\d{2}-\d{2})\]/
```

**Task interface:**

```typescript
interface Task {
  description: string;      // Text content (emoji markers stripped)
  dueDate: string | null;   // YYYY-MM-DD
  scheduledDate: string | null;
  isDone: boolean;
  priority: 'high' | 'medium' | 'low' | 'none';
  filePath: string;         // Relative path within vault
  lineNumber: number;       // For reference in messages
  rawLine: string;          // Original line for debugging
}
```

**Performance notes:** A typical Obsidian vault has hundreds to low-thousands of `.md` files. Synchronous `fs.readFileSync` in a single scan is fine — this runs once per cycle, not in a hot path. For very large vaults (10k+ files), consider streaming line-by-line with `readline`.

### 4.3 `reminder-engine.ts` — Reminder Decision Logic

**Responsibilities:** Given a list of tasks and today's date, determine which reminders need to be sent, consulting the sent-log to avoid duplicates.

**Algorithm for each undone task with a due date:**

1. Calculate `daysUntilDue = dueDate - today` (in the configured timezone)
2. If `daysUntilDue` is in `REMINDER_DAYS` (e.g., `[2, 1, 0]`), this task needs a reminder
3. Generate a unique reminder key: `hash(filePath + lineContent + dueDate + daysUntilDue)`
4. Check the sent-log — if this key exists, skip (already sent)
5. If not in sent-log, queue for sending

**Sent-log structure** (`sent-reminders.json`):

```json
{
  "reminders": {
    "<reminder-key>": {
      "sentAt": "2026-04-13T08:00:00+07:00",
      "task": "Buy groceries",
      "dueDate": "2026-04-15",
      "reminderType": "2-days-before"
    }
  },
  "lastCleanup": "2026-04-13"
}
```

**Cleanup:** On each run, remove entries older than 30 days to prevent unbounded growth.

**Edge cases to handle:**
- Task due date is in the past → send an "overdue" reminder (only once) if `daysUntilDue` is between `-7` and `-1`
- Task is edited to a new due date → new hash generates, new reminders fire
- Task is marked done between reminder cycles → scanner filters it out, no more reminders

### 4.4 `notifier.ts` — Telegram Sender

**Responsibilities:** Format and send reminder messages via the Telegram Bot API.

**Library:** `node-telegram-bot-api` (most popular, 14k+ stars, mature).

**Usage pattern** — the bot does NOT need polling (no incoming messages to process). It only sends outbound messages:

```typescript
import TelegramBot from 'node-telegram-bot-api';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
// No {polling: true} — we only send, never receive

await bot.sendMessage(TELEGRAM_CHAT_ID, messageText, {
  parse_mode: 'HTML'
});
```

**Message templates (HTML format):**

```
🔔 <b>Reminder: 2 days until due</b>

📝 Buy groceries for the party
📅 Due: 2026-04-15 (Tuesday)
⏫ Priority: High
📂 Shopping/weekly-tasks.md

---

⏰ <b>Reminder: Due tomorrow!</b>

📝 Buy groceries for the party
📅 Due: 2026-04-15 (Tuesday)
📂 Shopping/weekly-tasks.md

---

🚨 <b>DUE TODAY</b>

📝 Buy groceries for the party
📅 Due: 2026-04-15 (Tuesday)
📂 Shopping/weekly-tasks.md
```

**Batching:** If multiple tasks are due on the same reminder day, combine them into a single digest message to avoid spamming:

```
🔔 <b>3 tasks due in 2 days (Apr 15)</b>

1. Buy groceries for the party
   ⏫ High · Shopping/weekly-tasks.md

2. Submit expense report
   📂 Work/admin.md

3. Call dentist
   🔽 Low · Health/appointments.md
```

**Rate limiting:** Telegram allows ~30 messages per second to different chats, or ~1 per second to the same chat. For a personal reminder bot this is a non-issue, but add a small delay between messages if sending more than 5 in a burst.

### 4.5 `scheduler.ts` — Cron Scheduler

**Responsibilities:** Run the scan-evaluate-notify pipeline on a configured schedule.

**Library:** `node-cron` — lightweight, supports timezone-aware cron expressions.

```typescript
import cron from 'node-cron';

cron.schedule(SCAN_CRON, async () => {
  const tasks = await scanVault(VAULT_PATH);
  const reminders = evaluateReminders(tasks, new Date());
  await sendReminders(reminders);
}, {
  timezone: TIMEZONE
});
```

**Default schedule recommendation:** Run at 8:00 AM local time daily. Tasks due dates have day-level resolution (no time component in the Obsidian Tasks format), so scanning more than once or twice a day adds no value. An optional second scan at 6:00 PM catches tasks added during the day.

### 4.6 `index.ts` — Entry Point

**Responsibilities:** Wire everything together, handle graceful shutdown.

```typescript
// Load config, validate
// Initialize Telegram bot (send-only)
// Register cron job(s)
// Run initial scan on startup
// Handle SIGINT/SIGTERM for graceful shutdown
// Log startup confirmation
```

---

## 5. Project Structure

```
obsidian-task-telegram-reminder/
├── src/
│   ├── index.ts              # Entry point
│   ├── config.ts             # Configuration loader
│   ├── scanner.ts            # Vault file walker + task parser
│   ├── reminder-engine.ts    # Due-date logic + dedup
│   ├── notifier.ts           # Telegram message formatting + sending
│   ├── scheduler.ts          # Cron scheduling
│   ├── sent-log.ts           # JSON-based sent-reminder persistence
│   └── types.ts              # Shared TypeScript interfaces
├── config.json               # User configuration (scan schedule, etc.)
├── .env                      # Secrets (bot token, chat ID)
├── .env.example              # Template for .env
├── sent-reminders.json       # Auto-generated sent-log (gitignored)
├── package.json
├── tsconfig.json
└── README.md
```

---

## 6. Dependencies

| Package | Purpose | Version Strategy |
|---------|---------|-----------------|
| `node-telegram-bot-api` | Send Telegram messages | `^0.66.x` |
| `@types/node-telegram-bot-api` | TypeScript definitions | dev |
| `node-cron` | Schedule periodic scans | `^3.x` |
| `@types/node-cron` | TypeScript definitions | dev |
| `dotenv` | Load `.env` variables | `^16.x` |
| `glob` | Recursive file walking | `^10.x` or use `fs.globSync` (Node 22+) |
| `date-fns` | Date math (add/subtract days, format) | `^3.x` |
| `date-fns-tz` | Timezone-aware date operations | `^3.x` |
| `winston` | Structured logging | `^3.x` |
| `typescript` | Compile step | dev |
| `tsx` | Run TS directly in dev | dev |
| `vitest` | Testing | dev |

**Node.js version:** 18+ (for native `fs/promises`, stable ESM support).

---

## 7. Setup & Onboarding Flow

### 7.1 Telegram Bot Setup

1. Open Telegram, search for `@BotFather`
2. Send `/newbot`, follow prompts to name it (e.g., "Obsidian Reminder")
3. Copy the bot token → `TELEGRAM_BOT_TOKEN` in `.env`
4. Send any message to the bot from your personal account
5. Run the provided `get-chat-id.ts` helper script, which calls `getUpdates` and prints the chat ID → `TELEGRAM_CHAT_ID` in `.env`

### 7.2 Configuration

1. Clone the repo, run `npm install`
2. Copy `.env.example` to `.env`, fill in the three required values
3. Edit `config.json` for preferences (timezone, reminder schedule, etc.)
4. Run `npm run dev` to test, then `npm run build && npm start` for production

### 7.3 Running as a Background Service

**Option A — systemd (Linux):**

```ini
[Unit]
Description=Obsidian Telegram Reminder
After=network.target

[Service]
Type=simple
User=<your-user>
WorkingDirectory=/path/to/obsidian-task-telegram-reminder
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/path/to/obsidian-task-telegram-reminder/.env

[Install]
WantedBy=multi-user.target
```

**Option B — pm2:**

```bash
pm2 start dist/index.js --name obsidian-reminder
pm2 save
pm2 startup
```

**Option C — Docker:**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
COPY config.json ./
CMD ["node", "dist/index.js"]
```

Mount the vault folder as a read-only volume: `-v /path/to/vault:/vault:ro`

---

## 8. Implementation Phases

### Phase 1 — Core MVP (estimated: 1-2 days)

- [ ] Project scaffolding (TypeScript, package.json, tsconfig)
- [ ] Config loader with `.env` and validation
- [ ] Vault scanner: walk `.md` files, parse emoji-format tasks
- [ ] Reminder engine: compare due dates, determine what to send
- [ ] Sent-log: JSON read/write with dedup keys
- [ ] Telegram notifier: single-task message sending
- [ ] Cron scheduler wiring
- [ ] Entry point with startup scan + graceful shutdown

### Phase 2 — Polish (estimated: 1 day)

- [ ] Digest messages (batch multiple tasks into one message)
- [ ] Overdue task detection and reminders
- [ ] Priority display in messages
- [ ] File path / note name in messages for context
- [ ] Sent-log cleanup (prune old entries)
- [ ] Startup self-test (send a "bot connected" message)

### Phase 3 — Extended Features (estimated: 1-2 days)

- [ ] Dataview format support (`[due:: YYYY-MM-DD]`)
- [ ] Scheduled date (⏳) reminder support
- [ ] `/status` command — reply with today's upcoming tasks
- [ ] `/upcoming` command — show tasks due in next 7 days
- [ ] Configurable message templates
- [ ] Optional second daily scan (evening catch-up)

### Phase 4 — Robustness (estimated: 1 day)

- [ ] Unit tests for parser (various task formats, edge cases)
- [ ] Unit tests for reminder engine (date math, dedup)
- [ ] Integration test with sample vault
- [ ] Winston structured logging with rotation
- [ ] Docker packaging
- [ ] README with full setup guide

---

## 9. Key Design Decisions & Rationale

**Why not use chokidar / file watchers?**
Reminders have day-level granularity. Watching for file changes in real-time adds complexity (debouncing, handling renames/moves, dealing with Obsidian Sync conflicts) with no benefit. A daily or twice-daily scan is simpler and completely sufficient.

**Why a JSON file instead of SQLite?**
The sent-log only needs to track "has this specific reminder been sent?" — a simple key-value lookup. JSON is zero-dependency, human-readable, and trivially debuggable. At the scale of a personal vault (hundreds of tasks), performance is not a concern.

**Why `node-telegram-bot-api` over `telegraf`?**
This project only sends messages — it doesn't need Telegraf's middleware pipeline, scenes, or session management. `node-telegram-bot-api` is lower-level and simpler for send-only use. If Phase 3 adds bot commands (`/status`, `/upcoming`), either library works, but `node-telegram-bot-api` with simple `onText` handlers remains lighter.

**Why re-scan the whole vault each time?**
It's the same approach the gchat plugin uses (scan all notes each cycle), and it eliminates an entire class of stale-state bugs. A vault with 5,000 markdown files takes ~200ms to scan on modern hardware — negligible when running once or twice daily.

**Why hash-based dedup instead of tracking "last sent date per task"?**
Because tasks can be edited. If a user changes a due date, the hash changes and new reminders fire naturally. If they change the description, the hash also changes — this is intentional, as it might represent a meaningfully different task. The sent-log auto-cleans after 30 days regardless.

---

## 10. Testing Strategy

### 10.1 Unit Tests

**Scanner tests** — create temporary `.md` files with various task formats and verify parsing:
- Standard emoji format: `- [ ] Task 📅 2026-04-15`
- Multiple dates on one line: `- [ ] Task 🛫 2026-04-01 📅 2026-04-15`
- Done tasks: `- [x] Task 📅 2026-04-15 ✅ 2026-04-10` → should be filtered
- Indented tasks: `    - [ ] Subtask 📅 2026-04-15`
- Numbered lists: `1. [ ] Task 📅 2026-04-15`
- Edge cases: no date, malformed date, emoji in description text
- Dataview format: `- [ ] Task [due:: 2026-04-15]`

**Reminder engine tests** — mock today's date and verify correct reminder decisions:
- Task due in 2 days → generates "2 days before" reminder
- Task due tomorrow → generates "1 day before" reminder  
- Task due today → generates "due today" reminder
- Task due in 5 days → no reminder
- Task already reminded (in sent-log) → no duplicate
- Task with changed due date → new reminder

### 10.2 Integration Test

A `test-vault/` directory with sample notes. Run a full scan-evaluate cycle with a mock notifier to verify end-to-end behavior without actually hitting Telegram.

### 10.3 Manual Smoke Test

A `--dry-run` CLI flag that scans the vault, evaluates reminders, and prints what *would* be sent to the console instead of to Telegram.

---

## 11. Error Handling

| Scenario | Handling |
|----------|----------|
| Vault path doesn't exist | Fail on startup with clear error |
| `.md` file can't be read (permissions) | Log warning, skip file, continue scan |
| Malformed date in task line | Log debug, treat as no-date task |
| Telegram API error (network) | Retry 3 times with exponential backoff, then log error |
| Telegram API error (invalid token) | Fail on startup self-test |
| `sent-reminders.json` corrupted | Log warning, reset to empty, re-send reminders (safe — duplicates are benign) |
| Large vault slow scan | Log timing; if >10s, suggest `EXCLUDE_FOLDERS` |