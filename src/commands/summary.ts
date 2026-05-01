import {
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../bot.js';
import type { Database } from '../services/database.js';
import {
  formatSummaryFrequency,
  formatSummaryLayout,
  isValidSummaryTime,
  isValidTimeZone,
  SummaryService,
} from '../services/summary.js';
import type { EnabledSummarySettings, SummaryFrequency, SummaryLayout } from '../types.js';

type SummaryBuilder = Pick<SummaryService, 'buildSummary'>;

interface SummaryCommandOptions {
  summaryService?: SummaryBuilder;
  testGuildId?: string;
  includeManualSend?: boolean;
}

export function createSummaryCommand(db: Database, options: SummaryCommandOptions = {}): Command {
  const summaryService = options.summaryService ?? new SummaryService(db);
  const data = new SlashCommandBuilder()
    .setName('summary')
    .setDescription('Configure product summary digests (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub
        .setName('on')
        .setDescription('Enable summary digests in this server')
        .addStringOption(opt =>
          opt
            .setName('frequency')
            .setDescription('How often to send the summary')
            .setRequired(true)
            .addChoices(
              { name: 'Daily', value: 'daily' },
              { name: 'Weekly', value: 'weekly' },
              { name: 'Monthly', value: 'monthly' }
            )
        )
        .addStringOption(opt =>
          opt
            .setName('time')
            .setDescription('Local send time in HH:mm format')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('timezone')
            .setDescription('IANA timezone, for example Australia/Melbourne')
            .setRequired(true)
        )
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel for summaries; defaults to the current channel')
            .addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption(opt =>
          opt
            .setName('layout')
            .setDescription('Summary layout; compact is the default')
            .addChoices(
              { name: 'Compact', value: 'compact' },
              { name: 'Detailed', value: 'detailed' },
              { name: 'Image', value: 'image' }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('off')
        .setDescription('Disable summary digests in this server')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Show the current summary configuration')
    )
    .addSubcommand(sub =>
      sub
        .setName('preview')
        .setDescription('Preview the currently configured summary')
    )
    .addSubcommand(sub =>
      sub
        .setName('layout')
        .setDescription('Switch between compact, detailed, and image summary layouts')
        .addStringOption(opt =>
          opt
            .setName('mode')
            .setDescription('Layout to use for future summaries')
            .setRequired(true)
            .addChoices(
              { name: 'Compact', value: 'compact' },
              { name: 'Detailed', value: 'detailed' },
              { name: 'Image', value: 'image' }
            )
        )
    );

  if (options.includeManualSend) {
    data.addSubcommand(sub =>
      sub
        .setName('now')
        .setDescription('Send the configured summary immediately (test guild only)')
    );
  }

  return {
    data,
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      if (!interaction.guildId) {
        await interaction.reply({
          content: 'Summary settings are server-specific. Use this command inside a server.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'on':
          await handleOn(interaction, db);
          break;
        case 'off':
          await handleOff(interaction, db);
          break;
        case 'status':
          await handleStatus(interaction, db);
          break;
        case 'preview':
          await handlePreview(interaction, db, summaryService);
          break;
        case 'layout':
          await handleLayout(interaction, db);
          break;
        case 'now':
          await handleNow(interaction, db, summaryService, options.testGuildId);
          break;
      }
    },
  };
}

async function handleOn(interaction: ChatInputCommandInteraction, db: Database): Promise<void> {
  const frequency = interaction.options.getString('frequency', true) as SummaryFrequency;
  const time = interaction.options.getString('time', true);
  const timezone = interaction.options.getString('timezone', true);
  const layout = (interaction.options.getString('layout') as SummaryLayout | null) ?? 'compact';
  const channel = interaction.options.getChannel('channel');
  const channelId = channel?.id ?? interaction.channelId;

  if (!isValidSummaryTime(time)) {
    await interaction.reply({
      content: '❌ Summary time must use 24-hour HH:mm format, for example `09:00`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isValidTimeZone(timezone)) {
    await interaction.reply({
      content: '❌ Timezone must be a valid IANA timezone, for example `Australia/Melbourne`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!channelId) {
    await interaction.reply({
      content: '❌ Could not resolve a summary channel. Pass a channel explicitly.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  db.setSummarySettings(interaction.guildId!, {
    enabled: true,
    frequency,
    channelId,
    time,
    timezone,
    layout,
  });

  const cadence = formatCadence(frequency, time, timezone);
  await interaction.reply({
    content: `✅ ${formatSummaryFrequency(frequency)} summaries enabled in <#${channelId}>. ${cadence} Layout: ${formatSummaryLayout(layout)}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleOff(interaction: ChatInputCommandInteraction, db: Database): Promise<void> {
  db.disableSummary(interaction.guildId!);

  await interaction.reply({
    content: '✅ Summary digests are disabled for this server.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction, db: Database): Promise<void> {
  const settings = db.getSummarySettings(interaction.guildId!);

  if (
    !settings.summaryEnabled ||
    !settings.frequency ||
    !settings.channelId ||
    !settings.time ||
    !settings.timezone
  ) {
    await interaction.reply({
      content: 'Summary digests are disabled for this server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: [
      `**Summary Status:** ${formatSummaryFrequency(settings.frequency)} summaries enabled`,
      `Channel: <#${settings.channelId}>`,
      formatCadence(settings.frequency, settings.time, settings.timezone),
      `Layout: ${formatSummaryLayout(settings.layout)}`,
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleLayout(interaction: ChatInputCommandInteraction, db: Database): Promise<void> {
  const layout = interaction.options.getString('mode', true) as SummaryLayout;
  const settings = db.getSummarySettings(interaction.guildId!);

  db.setBotSetting(interaction.guildId!, 'summary_layout', layout);

  await interaction.reply({
    content: settings.summaryEnabled
      ? `✅ Summary layout set to ${formatSummaryLayout(layout)}.`
      : `✅ Summary layout set to ${formatSummaryLayout(layout)}. Summaries are still disabled.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePreview(
  interaction: ChatInputCommandInteraction,
  db: Database,
  summaryService: SummaryBuilder
): Promise<void> {
  const settings = db.getSummarySettings(interaction.guildId!);
  if (
    !settings.summaryEnabled ||
    !settings.frequency ||
    !settings.channelId ||
    !settings.time ||
    !settings.timezone
  ) {
    await interaction.reply({
      content: 'Summary digests are disabled for this server. Enable them with `/summary on` first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const enabledSettings: EnabledSummarySettings = {
    guildId: settings.guildId,
    summaryEnabled: true,
    frequency: settings.frequency,
    channelId: settings.channelId,
    time: settings.time,
    timezone: settings.timezone,
    layout: settings.layout,
  };
  const { embed, files } = await summaryService.buildSummary(enabledSettings);

  await interaction.editReply({ embeds: [embed], files });
}

async function handleNow(
  interaction: ChatInputCommandInteraction,
  db: Database,
  summaryService: SummaryBuilder,
  testGuildId: string | undefined
): Promise<void> {
  if (!testGuildId) {
    await interaction.reply({
      content: 'Manual summary sending is not configured for this bot.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.guildId !== testGuildId) {
    await interaction.reply({
      content: 'Manual summary sending is restricted to the configured test server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const settings = db.getSummarySettings(interaction.guildId!);
  if (
    !settings.summaryEnabled ||
    !settings.frequency ||
    !settings.channelId ||
    !settings.time ||
    !settings.timezone
  ) {
    await interaction.reply({
      content: 'Summary digests are disabled for this server. Enable them with `/summary on` first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const enabledSettings: EnabledSummarySettings = {
    guildId: settings.guildId,
    summaryEnabled: true,
    frequency: settings.frequency,
    channelId: settings.channelId,
    time: settings.time,
    timezone: settings.timezone,
    layout: settings.layout,
  };
  const { embed, files } = await summaryService.buildSummary(enabledSettings);

  await interaction.editReply({ embeds: [embed], files });
}

function formatCadence(frequency: SummaryFrequency, time: string, timezone: string): string {
  if (frequency === 'weekly') {
    return `Schedule: Mondays at ${time} ${timezone}.`;
  }

  if (frequency === 'monthly') {
    return `Schedule: the 1st of each month at ${time} ${timezone}.`;
  }

  return `Schedule: daily at ${time} ${timezone}.`;
}
