/**
 * Helper script to get your Telegram chat ID
 *
 * Usage:
 * 1. Create a bot with @BotFather and get your bot token
 * 2. Set TELEGRAM_BOT_TOKEN in your .env file
 * 3. Send any message to your bot on Telegram
 * 4. Run: npm run get-chat-id
 * 5. Copy the chat ID to TELEGRAM_CHAT_ID in your .env file
 */

import { config as dotenvConfig } from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';

dotenvConfig();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('Error: TELEGRAM_BOT_TOKEN not found in .env file');
  console.log('\nTo set up:');
  console.log('1. Create a bot with @BotFather on Telegram');
  console.log('2. Copy the bot token');
  console.log('3. Add to .env: TELEGRAM_BOT_TOKEN=your_token_here');
  process.exit(1);
}

console.log('Fetching updates from Telegram...');
console.log('(Make sure you have sent a message to your bot first!)\n');

const bot = new TelegramBot(token);

async function main() {
  try {
    const updates = await bot.getUpdates({ limit: 10, offset: -10 });

    if (updates.length === 0) {
      console.log('No messages found!');
      console.log('\nTo get your chat ID:');
      console.log('1. Open Telegram and find your bot');
      console.log('2. Send any message to the bot');
      console.log('3. Run this script again');
      process.exit(1);
    }

    console.log('Found messages from:\n');

    const seen = new Set<number>();
    for (const update of updates) {
      const chat = update.message?.chat;
      if (chat && !seen.has(chat.id)) {
        seen.add(chat.id);
        const name = chat.first_name
          ? `${chat.first_name}${chat.last_name ? ' ' + chat.last_name : ''}`
          : chat.title || 'Unknown';
        const type = chat.type;

        console.log(`  Chat ID: ${chat.id}`);
        console.log(`  Name: ${name}`);
        console.log(`  Type: ${type}`);
        console.log('');
      }
    }

    console.log('Copy the Chat ID and add to your .env file:');
    console.log(`TELEGRAM_CHAT_ID=${updates[0].message?.chat.id}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      console.error('Error: Invalid bot token. Please check your TELEGRAM_BOT_TOKEN.');
    } else {
      console.error('Error:', error);
    }
    process.exit(1);
  }
}

main();
