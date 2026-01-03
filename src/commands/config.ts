import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import type { Command } from '../bot.js';
import type { Database } from '../services/database.js';

const ALERT_TYPES = ['price_drop', 'price_spike', 'new_product', 'back_in_stock'] as const;

const SETTING_KEYS = {
  channel_price_drop: 'Price Drop Channel',
  channel_price_spike: 'Price Spike Channel',
  channel_new_product: 'New Product Channel',
  channel_back_in_stock: 'Back in Stock Channel',
  alert_price_drop_enabled: 'Price Drop Alerts',
  alert_price_spike_enabled: 'Price Spike Alerts',
  alert_new_product_enabled: 'New Product Alerts',
  alert_back_in_stock_enabled: 'Back in Stock Alerts',
  price_drop_threshold: 'Price Drop Threshold',
  price_spike_threshold: 'Price Spike Threshold',
  poll_interval_ms: 'Poll Interval (ms)',
  alert_cooldown_ms: 'Alert Cooldown (ms)',
} as const;

export function createConfigCommand(db: Database): Command {
  const data = new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure bot settings (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub
        .setName('show')
        .setDescription('Show current configuration')
    )
    .addSubcommand(sub =>
      sub
        .setName('channel')
        .setDescription('Set channel for a specific alert type')
        .addStringOption(opt =>
          opt
            .setName('alert_type')
            .setDescription('Type of alert')
            .setRequired(true)
            .addChoices(
              { name: 'Price Drop', value: 'price_drop' },
              { name: 'Price Spike', value: 'price_spike' },
              { name: 'New Product', value: 'new_product' },
              { name: 'Back in Stock', value: 'back_in_stock' }
            )
        )
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to send alerts to (leave empty to use default)')
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('toggle')
        .setDescription('Enable or disable an alert type')
        .addStringOption(opt =>
          opt
            .setName('alert_type')
            .setDescription('Type of alert')
            .setRequired(true)
            .addChoices(
              { name: 'Price Drop', value: 'price_drop' },
              { name: 'Price Spike', value: 'price_spike' },
              { name: 'New Product', value: 'new_product' },
              { name: 'Back in Stock', value: 'back_in_stock' }
            )
        )
        .addBooleanOption(opt =>
          opt
            .setName('enabled')
            .setDescription('Enable or disable this alert type')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('threshold')
        .setDescription('Set price change threshold')
        .addStringOption(opt =>
          opt
            .setName('type')
            .setDescription('Which threshold to set')
            .setRequired(true)
            .addChoices(
              { name: 'Price Drop', value: 'price_drop' },
              { name: 'Price Spike', value: 'price_spike' }
            )
        )
        .addNumberOption(opt =>
          opt
            .setName('percent')
            .setDescription('Threshold percentage (e.g., 5 for 5%). Leave empty to reset to default.')
            .setMinValue(0.1)
            .setMaxValue(100)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('interval')
        .setDescription('Set polling interval')
        .addIntegerOption(opt =>
          opt
            .setName('seconds')
            .setDescription('Polling interval in seconds (min: 60). Leave empty to reset to default.')
            .setMinValue(60)
            .setMaxValue(3600)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('cooldown')
        .setDescription('Set alert cooldown')
        .addIntegerOption(opt =>
          opt
            .setName('minutes')
            .setDescription('Cooldown in minutes (min: 1). Leave empty to reset to default.')
            .setMinValue(1)
            .setMaxValue(1440)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('reset')
        .setDescription('Reset all settings to .env defaults')
    );

  return {
    data,
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'show':
          await handleShow(interaction, db);
          break;
        case 'channel':
          await handleChannel(interaction, db);
          break;
        case 'toggle':
          await handleToggle(interaction, db);
          break;
        case 'threshold':
          await handleThreshold(interaction, db);
          break;
        case 'interval':
          await handleInterval(interaction, db);
          break;
        case 'cooldown':
          await handleCooldown(interaction, db);
          break;
        case 'reset':
          await handleReset(interaction, db);
          break;
      }
    },
  };
}

async function handleShow(interaction: ChatInputCommandInteraction, db: Database): Promise<void> {
  const settings = db.getBotSettings();
  const config = db.getAllConfig();

  const lines: string[] = [
    '**Current Configuration**',
    '',
    '**Alert Channels:**',
    `- Price Drop: ${settings.channelPriceDrop ? `<#${settings.channelPriceDrop}>` : '(default)'}`,
    `- Price Spike: ${settings.channelPriceSpike ? `<#${settings.channelPriceSpike}>` : '(default)'}`,
    `- New Product: ${settings.channelNewProduct ? `<#${settings.channelNewProduct}>` : '(default)'}`,
    `- Back in Stock: ${settings.channelBackInStock ? `<#${settings.channelBackInStock}>` : '(default)'}`,
    '',
    '**Alert Toggles:**',
    `- Price Drop: ${settings.alertPriceDropEnabled ? '✅ Enabled' : '❌ Disabled'}`,
    `- Price Spike: ${settings.alertPriceSpikeEnabled ? '✅ Enabled' : '❌ Disabled'}`,
    `- New Product: ${settings.alertNewProductEnabled ? '✅ Enabled' : '❌ Disabled'}`,
    `- Back in Stock: ${settings.alertBackInStockEnabled ? '✅ Enabled' : '❌ Disabled'}`,
    '',
    '**Thresholds:**',
    `- Price Drop: ${settings.priceDropThreshold !== null ? `${(settings.priceDropThreshold * 100).toFixed(1)}%` : '(default from .env)'}`,
    `- Price Spike: ${settings.priceSpikeThreshold !== null ? `${(settings.priceSpikeThreshold * 100).toFixed(1)}%` : '(default from .env)'}`,
    '',
    '**Timing:**',
    `- Poll Interval: ${settings.pollIntervalMs !== null ? `${settings.pollIntervalMs / 1000}s` : '(default from .env)'}`,
    `- Alert Cooldown: ${settings.alertCooldownMs !== null ? `${settings.alertCooldownMs / 60000}min` : '(default from .env)'}`,
  ];

  await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
}

async function handleChannel(interaction: ChatInputCommandInteraction, db: Database): Promise<void> {
  const alertType = interaction.options.getString('alert_type', true);
  const channel = interaction.options.getChannel('channel');
  const configKey = `channel_${alertType}`;

  if (channel) {
    db.setBotSetting(configKey, channel.id);
    await interaction.reply({
      content: `✅ ${formatAlertType(alertType)} alerts will now be sent to <#${channel.id}>`,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    db.setBotSetting(configKey, null);
    await interaction.reply({
      content: `✅ ${formatAlertType(alertType)} alerts will now use the default channel`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleToggle(interaction: ChatInputCommandInteraction, db: Database): Promise<void> {
  const alertType = interaction.options.getString('alert_type', true);
  const enabled = interaction.options.getBoolean('enabled', true);
  const configKey = `alert_${alertType}_enabled`;

  db.setBotSetting(configKey, enabled.toString());
  
  await interaction.reply({
    content: `✅ ${formatAlertType(alertType)} alerts are now ${enabled ? '**enabled**' : '**disabled**'}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleThreshold(interaction: ChatInputCommandInteraction, db: Database): Promise<void> {
  const type = interaction.options.getString('type', true);
  const percent = interaction.options.getNumber('percent');
  const configKey = `${type}_threshold`;

  if (percent !== null) {
    const decimal = percent / 100;
    db.setBotSetting(configKey, decimal.toString());
    await interaction.reply({
      content: `✅ ${formatAlertType(type)} threshold set to **${percent}%**`,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    db.setBotSetting(configKey, null);
    await interaction.reply({
      content: `✅ ${formatAlertType(type)} threshold reset to .env default`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleInterval(interaction: ChatInputCommandInteraction, db: Database): Promise<void> {
  const seconds = interaction.options.getInteger('seconds');

  if (seconds !== null) {
    const ms = seconds * 1000;
    db.setBotSetting('poll_interval_ms', ms.toString());
    await interaction.reply({
      content: `✅ Poll interval set to **${seconds} seconds**\n⚠️ Restart the bot for this change to take effect.`,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    db.setBotSetting('poll_interval_ms', null);
    await interaction.reply({
      content: `✅ Poll interval reset to .env default\n⚠️ Restart the bot for this change to take effect.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleCooldown(interaction: ChatInputCommandInteraction, db: Database): Promise<void> {
  const minutes = interaction.options.getInteger('minutes');

  if (minutes !== null) {
    const ms = minutes * 60 * 1000;
    db.setBotSetting('alert_cooldown_ms', ms.toString());
    await interaction.reply({
      content: `✅ Alert cooldown set to **${minutes} minutes**`,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    db.setBotSetting('alert_cooldown_ms', null);
    await interaction.reply({
      content: `✅ Alert cooldown reset to .env default`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleReset(interaction: ChatInputCommandInteraction, db: Database): Promise<void> {
  for (const key of Object.keys(SETTING_KEYS)) {
    db.setBotSetting(key, null);
  }

  await interaction.reply({
    content: '✅ All settings reset to .env defaults\n⚠️ Restart the bot for interval changes to take effect.',
    flags: MessageFlags.Ephemeral,
  });
}

function formatAlertType(type: string): string {
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
