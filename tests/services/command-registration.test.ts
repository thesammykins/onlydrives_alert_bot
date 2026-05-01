import { Events } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../src/services/database.js';
import { GuildCommandRegistrar } from '../../src/services/command-registration.js';
import type { Config } from '../../src/types.js';

const config: Config = {
  discord: {
    token: 'discord-token',
    clientId: 'client-id',
    guildId: 'guild-a',
    alertChannelId: 'alert-channel',
    summaryTestGuildId: 'test-guild',
  },
  monitoring: {
    pollIntervalMs: 300000,
    priceDropThreshold: 0.05,
    priceSpikeThreshold: 0.10,
    alertCooldownMs: 14400000,
  },
  logLevel: 'info',
};

interface CommandJson {
  name: string;
  options?: Array<{ name: string }>;
}

function summarySubcommandNames(body: unknown): string[] {
  const commands = body as CommandJson[];
  const summary = commands.find(command => command.name === 'summary');
  return summary?.options?.map(option => option.name) ?? [];
}

describe('GuildCommandRegistrar', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('syncs commands for every joined guild on startup', async () => {
    const put = vi.fn(async () => undefined);
    const registrar = new GuildCommandRegistrar(db, config, { put });
    const client = {
      guilds: {
        cache: new Map([
          ['guild-a', { id: 'guild-a' }],
          ['guild-b', { id: 'guild-b' }],
        ]),
      },
    };

    await registrar.syncJoinedGuilds(client as never);

    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[0]?.[0]).toContain('/guilds/guild-a/commands');
    expect(put.mock.calls[1]?.[0]).toContain('/guilds/guild-b/commands');
  });

  it('syncs a new guild when the bot is added', async () => {
    const put = vi.fn(async () => undefined);
    const on = vi.fn();
    const registrar = new GuildCommandRegistrar(db, config, { put });

    registrar.registerGuildCreateHandler({ on } as never);
    const handler = on.mock.calls[0]?.[1] as ((guild: { id: string }) => Promise<void>) | undefined;
    await handler?.({ id: 'new-guild' });

    expect(on).toHaveBeenCalledWith(Events.GuildCreate, expect.any(Function));
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[0]).toContain('/guilds/new-guild/commands');
  });

  it('includes /summary now only for the configured test guild', async () => {
    const put = vi.fn(async () => undefined);
    const registrar = new GuildCommandRegistrar(db, config, { put });

    await registrar.syncGuilds(['guild-a', 'test-guild']);

    const normalBody = put.mock.calls[0]?.[1].body;
    const testBody = put.mock.calls[1]?.[1].body;

    expect(summarySubcommandNames(normalBody)).not.toContain('now');
    expect(summarySubcommandNames(testBody)).toContain('now');
  });

  it('logs registration failures and continues with remaining guilds', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const put = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const registrar = new GuildCommandRegistrar(db, config, { put });

    const results = await registrar.syncGuilds(['guild-a', 'guild-b']);

    expect(results).toEqual([
      { guildId: 'guild-a', ok: false },
      { guildId: 'guild-b', ok: true },
    ]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to sync commands for guild guild-a'),
      expect.any(Error)
    );
    expect(put).toHaveBeenCalledTimes(2);
  });
});
