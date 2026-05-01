import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { createSummaryCommand } from '../../src/commands/summary.js';
import { Database } from '../../src/services/database.js';
import type { EnabledSummarySettings } from '../../src/types.js';

function createInteraction(options: {
  subcommand: string;
  guildId?: string | null;
  channelId?: string | null;
  strings?: Record<string, string>;
  channel?: { id: string } | null;
}) {
  return {
    guildId: options.guildId === undefined ? 'guild-1' : options.guildId,
    channelId: options.channelId ?? 'current-channel',
    options: {
      getSubcommand: vi.fn(() => options.subcommand),
      getString: vi.fn((name: string) => options.strings?.[name] ?? null),
      getChannel: vi.fn(() => options.channel ?? null),
    },
    reply: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction & {
    reply: ReturnType<typeof vi.fn>;
    deferReply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
  };
}

describe('summary command', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('rejects use in DMs', async () => {
    const command = createSummaryCommand(db);
    const interaction = createInteraction({ subcommand: 'status', guildId: null });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('server-specific'),
    }));
  });

  it('rejects invalid HH:mm times', async () => {
    const command = createSummaryCommand(db);
    const interaction = createInteraction({
      subcommand: 'on',
      strings: {
        frequency: 'daily',
        time: '9am',
        timezone: 'Australia/Melbourne',
      },
    });

    await command.execute(interaction);

    expect(db.getSummarySettings('guild-1').summaryEnabled).toBe(false);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('HH:mm'),
    }));
  });

  it('rejects invalid timezones', async () => {
    const command = createSummaryCommand(db);
    const interaction = createInteraction({
      subcommand: 'on',
      strings: {
        frequency: 'daily',
        time: '09:00',
        timezone: 'Not/AZone',
      },
    });

    await command.execute(interaction);

    expect(db.getSummarySettings('guild-1').summaryEnabled).toBe(false);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('IANA timezone'),
    }));
  });

  it('disables only the current guild', async () => {
    db.setSummarySettings('guild-1', {
      enabled: true,
      frequency: 'daily',
      channelId: 'channel-1',
      time: '09:00',
      timezone: 'Australia/Melbourne',
    });
    db.setSummarySettings('guild-2', {
      enabled: true,
      frequency: 'weekly',
      channelId: 'channel-2',
      time: '09:00',
      timezone: 'Australia/Melbourne',
    });

    const command = createSummaryCommand(db);
    const interaction = createInteraction({ subcommand: 'off', guildId: 'guild-1' });

    await command.execute(interaction);

    expect(db.getSummarySettings('guild-1').summaryEnabled).toBe(false);
    expect(db.getSummarySettings('guild-2').summaryEnabled).toBe(true);
  });

  it('previews the currently stored summary cadence', async () => {
    db.setSummarySettings('guild-1', {
      enabled: true,
      frequency: 'monthly',
      channelId: 'summary-channel',
      time: '09:00',
      timezone: 'Australia/Melbourne',
    });
    const buildSummary = vi.fn(async (settings: EnabledSummarySettings) => ({
      embed: new EmbedBuilder().setTitle(`${settings.frequency} preview`),
    }));
    const command = createSummaryCommand(db, { summaryService: { buildSummary } });
    const interaction = createInteraction({ subcommand: 'preview', guildId: 'guild-1' });

    await command.execute(interaction);

    expect(buildSummary).toHaveBeenCalledWith(expect.objectContaining({
      frequency: 'monthly',
      channelId: 'summary-channel',
      timezone: 'Australia/Melbourne',
    }));
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('rejects /summary now outside the configured test guild', async () => {
    db.setSummarySettings('guild-1', {
      enabled: true,
      frequency: 'daily',
      channelId: 'summary-channel',
      time: '09:00',
      timezone: 'Australia/Melbourne',
    });
    const command = createSummaryCommand(db, { testGuildId: 'test-guild' });
    const interaction = createInteraction({ subcommand: 'now', guildId: 'guild-1' });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('restricted'),
    }));
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('sends /summary now in the configured test guild using the stored cadence', async () => {
    db.setSummarySettings('test-guild', {
      enabled: true,
      frequency: 'weekly',
      channelId: 'summary-channel',
      time: '09:00',
      timezone: 'Australia/Melbourne',
    });
    const buildSummary = vi.fn(async (settings: EnabledSummarySettings) => ({
      embed: new EmbedBuilder().setTitle(`${settings.frequency} now`),
    }));
    const command = createSummaryCommand(db, {
      summaryService: { buildSummary },
      testGuildId: 'test-guild',
    });
    const interaction = createInteraction({ subcommand: 'now', guildId: 'test-guild' });

    await command.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith();
    expect(buildSummary).toHaveBeenCalledWith(expect.objectContaining({
      frequency: 'weekly',
      guildId: 'test-guild',
    }));
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
    }));
  });
});
