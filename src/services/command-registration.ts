import { Events, REST, Routes } from 'discord.js';
import type { Client, Guild } from 'discord.js';
import { loadCommands } from '../commands/index.js';
import type { Config } from '../types.js';
import type { Database } from './database.js';

interface CommandRestClient {
  put(route: string, options: { body: unknown[] }): Promise<unknown>;
}

export interface GuildCommandSyncResult {
  guildId: string;
  ok: boolean;
}

export class GuildCommandRegistrar {
  private db: Database;
  private config: Config;
  private rest: CommandRestClient;

  constructor(
    db: Database,
    config: Config,
    rest: CommandRestClient = new REST().setToken(config.discord.token)
  ) {
    this.db = db;
    this.config = config;
    this.rest = rest;
  }

  async syncJoinedGuilds(client: Client): Promise<GuildCommandSyncResult[]> {
    return this.syncGuilds(Array.from(client.guilds.cache.values(), guild => guild.id));
  }

  registerGuildCreateHandler(client: Client): void {
    client.on(Events.GuildCreate, async (guild: Guild) => {
      await this.syncGuild(guild.id);
    });
  }

  async syncGuilds(guildIds: Iterable<string>): Promise<GuildCommandSyncResult[]> {
    const uniqueGuildIds = [...new Set(guildIds)];
    const results: GuildCommandSyncResult[] = [];

    for (const guildId of uniqueGuildIds) {
      results.push(await this.syncGuild(guildId));
    }

    return results;
  }

  async syncGuild(guildId: string): Promise<GuildCommandSyncResult> {
    const commands = loadCommands(this.db, this.config, { guildId });
    const commandData = commands.map(command => command.data.toJSON());

    try {
      await this.rest.put(
        Routes.applicationGuildCommands(this.config.discord.clientId, guildId),
        { body: commandData }
      );
      console.log(`[CommandRegistration] Synced ${commandData.length} commands for guild ${guildId}`);
      return { guildId, ok: true };
    } catch (error) {
      console.error(`[CommandRegistration] Failed to sync commands for guild ${guildId}:`, error);
      return { guildId, ok: false };
    }
  }
}
