import { Events } from 'discord.js';
import { createClient } from './bot.js';
import { loadConfig } from './config.js';
import { Database } from './services/database.js';
import { MonitorOrchestrator } from './monitors/index.js';
import { loadCommands } from './commands/index.js';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = './data';
const DB_PATH = path.join(DATA_DIR, 'bot.db');

async function main(): Promise<void> {
  console.log('[Main] Starting OnlyDrives Alert Bot...');

  const config = loadConfig();
  console.log('[Main] Configuration loaded');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  console.log('[Main] Database initialized');

  const client = createClient();

  const commands = loadCommands(db);
  for (const command of commands) {
    client.commands.set(command.data.name, command);
  }
  console.log(`[Main] Loaded ${commands.length} commands`);

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`[Main] Logged in as ${readyClient.user.tag}`);

    const monitor = new MonitorOrchestrator(client, config, db);
    monitor.start();

    const shutdown = () => {
      console.log('[Main] Shutting down...');
      monitor.stop();
      db.close();
      client.destroy();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

  await client.login(config.discord.token);
}

main().catch((error) => {
  console.error('[Main] Fatal error:', error);
  process.exit(1);
});
