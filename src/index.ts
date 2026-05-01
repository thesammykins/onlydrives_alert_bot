import { Events } from 'discord.js';
import type { Client } from 'discord.js';
import { createClient, setupMessageHandler } from './bot.js';
import { loadConfig } from './config.js';
import { Database } from './services/database.js';
import { MonitorOrchestrator } from './monitors/index.js';
import { loadCommands } from './commands/index.js';
import { SummaryScheduler } from './services/summary-scheduler.js';
import { GuildCommandRegistrar } from './services/command-registration.js';
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

  const commands = loadCommands(db, config);
  for (const command of commands) {
    client.commands.set(command.data.name, command);
  }
  console.log(`[Main] Loaded ${commands.length} commands`);

  setupMessageHandler(client, db);
  console.log('[Main] Message handler configured');

  const commandRegistrar = new GuildCommandRegistrar(db, config);
  commandRegistrar.registerGuildCreateHandler(client);

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[Main] Logged in as ${readyClient.user.tag}`);

    const legacyGuildId = await resolveLegacyGuildId(client, config.discord.guildId, config.discord.alertChannelId);
    if (legacyGuildId) {
      db.migrateLegacyGlobalConfig(legacyGuildId, config.discord.alertChannelId);
      console.log(`[Main] Migrated legacy server config for guild ${legacyGuildId}`);
    }

    await commandRegistrar.syncJoinedGuilds(readyClient);

    const monitor = new MonitorOrchestrator(client, config, db);
    monitor.start();

    const summaryScheduler = new SummaryScheduler(client, db);
    summaryScheduler.start();

    const shutdown = () => {
      console.log('[Main] Shutting down...');
      monitor.stop();
      summaryScheduler.stop();
      db.close();
      client.destroy();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

  await client.login(config.discord.token);
}

async function resolveLegacyGuildId(
  client: Client,
  configuredGuildId: string | undefined,
  alertChannelId: string
): Promise<string | null> {
  if (configuredGuildId) {
    return configuredGuildId;
  }

  try {
    const channel = await client.channels.fetch(alertChannelId);
    if (channel && 'guildId' in channel && typeof channel.guildId === 'string') {
      return channel.guildId;
    }
  } catch (error) {
    console.warn('[Main] Could not resolve legacy guild from alert channel:', error);
  }

  return null;
}

main().catch((error) => {
  console.error('[Main] Fatal error:', error);
  process.exit(1);
});
