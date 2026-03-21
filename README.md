# Obsidian Telegram Reminder

A standalone Node.js background service that monitors your Obsidian vault for tasks with due dates and sends you Telegram reminders.

## Features

- **Task Scanning**: Parses tasks using the [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) emoji format
- **Smart Reminders**: Sends reminders 2 days before, 1 day before, and on the due date
- **Overdue Detection**: Alerts you about overdue tasks (up to 7 days)
- **Digest Messages**: Groups multiple tasks into single messages to avoid spam
- **Priority Support**: Displays task priorities (high/medium/low) in messages
- **Dataview Format**: Optional support for `[due:: YYYY-MM-DD]` format
- **Bot Commands**: `/status` and `/upcoming` commands for on-demand task queries
- **Duplicate Prevention**: Never sends the same reminder twice
- **Timezone Support**: Configurable timezone for accurate date calculations

## Task Format

The scanner recognizes the Obsidian Tasks plugin format:

```markdown
- [ ] Buy groceries 📅 2026-04-15
- [ ] Submit report 📅 2026-04-16 ⏫
- [ ] Call dentist 📅 2026-04-17 🔽
```

### Supported Emojis

| Emoji | Meaning | Example |
|-------|---------|---------|
| 📅 | Due date | `📅 2026-04-15` |
| ⏳ | Scheduled date | `⏳ 2026-04-10` |
| ⏫ | High priority | - |
| 🔼 | Medium priority | - |
| 🔽 | Low priority | - |

### Optional Dataview Format

Enable `dataviewFormat` in config.json to also parse:

```markdown
- [ ] Task description [due:: 2026-04-15]
```

## Installation

### Prerequisites

- Node.js 18 or higher
- A Telegram bot (create one via [@BotFather](https://t.me/BotFather))
- Your Telegram chat ID

### Setup

1. **Clone and install**

```bash
git clone https://github.com/your-username/obsidian-telegram-reminder.git
cd obsidian-telegram-reminder
npm install
```

2. **Create your Telegram bot**

   - Open Telegram and message [@BotFather](https://t.me/BotFather)
   - Send `/newbot` and follow the prompts
   - Copy the bot token

3. **Get your chat ID**

   - Send any message to your new bot
   - Run: `npm run get-chat-id`
   - Copy the chat ID from the output

4. **Configure environment**

```bash
cp .env.example .env
```

Edit `.env`:

```ini
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
VAULT_PATH=/path/to/your/obsidian/vault
```

5. **Configure options** (optional)

Edit `config.json` to customize:

```json
{
  "scanCron": "*/15 * * * *",
  "reminderDays": [2, 1, 0],
  "timezone": "Asia/Jakarta",
  "excludeFolders": [".obsidian", ".trash", "templates"]
}
```

6. **Build and run**

```bash
npm run build
npm start
```

## Running as a Service

### Systemd (Linux)

```bash
# Run the setup script
sudo ./scripts/setup-systemd.sh

# Start the service
sudo systemctl start obsidian-reminder

# View logs
sudo journalctl -u obsidian-reminder -f
```

### Docker

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f
```

### PM2

```bash
pm2 start dist/index.js --name obsidian-reminder
pm2 save
pm2 startup
```

## Configuration

### Environment Variables (.env)

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Your Telegram chat ID |
| `VAULT_PATH` | Yes | Absolute path to Obsidian vault |

### Application Config (config.json)

| Option | Default | Description |
|--------|---------|-------------|
| `scanCron` | `*/15 * * * *` | Cron expression for scan schedule |
| `reminderDays` | `[2, 1, 0]` | Days before due to remind |
| `timezone` | `Asia/Jakarta` | IANA timezone string |
| `excludeFolders` | `[".obsidian", ".trash"]` | Folders to skip |
| `includeScheduled` | `false` | Also remind on ⏳ dates |
| `dataviewFormat` | `false` | Parse `[due:: date]` format |
| `logLevel` | `info` | Logging verbosity |
| `eveningScanCron` | `null` | Optional second daily scan |

## Bot Commands

Once running, you can interact with your bot:

- `/status` - Show tasks due today and upcoming
- `/upcoming` - Show all tasks due in the next 7 days
- `/help` - Show available commands

## Development

```bash
# Run in development mode (with hot reload)
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Dry run (shows what would be sent)
npm run dry-run
```

## Message Format

### Single Task

```
🔔 Reminder: 2 days until due

📝 Buy groceries for the party
📅 Due: 2026-04-15 (Tuesday)
🔴 High
📂 Shopping/weekly-tasks.md
```

### Multiple Tasks (Digest)

```
⏰ DUE TODAY
3 tasks - 2026-04-15 (Tuesday)

1. Buy groceries for the party
   🔴 High · Shopping/weekly-tasks.md

2. Submit expense report
   📂 Work/admin.md

3. Call dentist
   🟢 Low · Health/appointments.md
```

## License

MIT

## Acknowledgments

- [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) for the task format
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) for Telegram integration
