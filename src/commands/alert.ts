import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  AutocompleteInteraction,
  MessageFlags,
} from 'discord.js';
import type { Command } from '../bot.js';
import type { Database } from '../services/database.js';
import type { AlertEvent, AlertType, Product } from '../types.js';
import { OnlyDrivesApi } from '../services/api.js';
import { createAlertEmbed } from '../utils/embed.js';
import { formatSkuList, parseSkuList } from '../utils/sku.js';

export function createAlertCommand(db: Database): Command {
  const api = new OnlyDrivesApi();

  const data = new SlashCommandBuilder()
    .setName('alert')
    .setDescription('Manage personal price alerts for specific SKUs')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Subscribe to price alerts for one or more SKUs')
        .addStringOption(opt =>
          opt
            .setName('skus')
            .setDescription('Product SKUs to watch (comma or space separated)')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(opt =>
          opt
            .setName('delivery')
            .setDescription('How to receive alerts')
            .setRequired(true)
            .addChoices(
              { name: 'Direct Message', value: 'dm' },
              { name: 'In Channel', value: 'channel' }
            )
        )
        .addNumberOption(opt =>
          opt
            .setName('price_drop')
            .setDescription('Override drop threshold for these SKUs (percent)')
            .setMinValue(0)
            .setMaxValue(100)
        )
        .addNumberOption(opt =>
          opt
            .setName('price_spike')
            .setDescription('Override spike threshold for these SKUs (percent)')
            .setMinValue(0)
            .setMaxValue(100)
        )
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to send alerts to (only if delivery is "In Channel")')
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Unsubscribe from price alerts for one or more SKUs')
        .addStringOption(opt =>
          opt
            .setName('skus')
            .setDescription('Product SKUs to stop watching (comma or space separated)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List your active SKU subscriptions')
    )
    .addSubcommand(sub =>
      sub
        .setName('quiet')
        .setDescription('Set quiet hours for your personal alerts')
        .addIntegerOption(opt =>
          opt
            .setName('start')
            .setDescription('Quiet hours start (0-23, local time)')
            .setMinValue(0)
            .setMaxValue(23)
        )
        .addIntegerOption(opt =>
          opt
            .setName('end')
            .setDescription('Quiet hours end (0-23, local time)')
            .setMinValue(0)
            .setMaxValue(23)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('test')
        .setDescription('Preview an alert embed for a SKU')
        .addStringOption(opt =>
          opt
            .setName('sku')
            .setDescription('SKU to preview')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(opt =>
          opt
            .setName('type')
            .setDescription('Alert type to preview')
            .setRequired(true)
            .addChoices(
              { name: 'Price Drop', value: 'price_drop' },
              { name: 'Price Spike', value: 'price_spike' },
              { name: 'New Product', value: 'new_product' },
              { name: 'Back in Stock', value: 'back_in_stock' }
            )
        )
    );

  return {
    data,
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'add':
          await handleAdd(interaction, db);
          break;
        case 'remove':
          await handleRemove(interaction, db);
          break;
        case 'list':
          await handleList(interaction, db);
          break;
        case 'quiet':
          await handleQuiet(interaction, db);
          break;
        case 'test':
          await handleTest(interaction, db);
          break;
      }
    },
    async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
      const focused = interaction.options.getFocused(true);
      if (!['skus', 'sku'].includes(focused.name)) {
        await interaction.respond([]);
        return;
      }

      const focusedValue = focused.value.toUpperCase();

      try {
        const products = await api.fetchProducts();
        const matches = products
          .filter(p => p.sku.toUpperCase().includes(focusedValue) || p.name.toLowerCase().includes(focusedValue.toLowerCase()))
          .slice(0, 25)
          .map(p => ({
            name: `${p.sku} - ${p.name.slice(0, 80)}`,
            value: p.sku,
          }));

        await interaction.respond(matches);
      } catch {
        const cached = db.getCachedProducts();
        const matches = cached
          .filter(p => p.sku.toUpperCase().includes(focusedValue) || p.name.toLowerCase().includes(focusedValue.toLowerCase()))
          .slice(0, 25)
          .map(p => ({
            name: `${p.sku} - ${p.name.slice(0, 80)}`,
            value: p.sku,
          }));
        await interaction.respond(matches);
      }
    },
  };
}

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  db: Database
): Promise<void> {
  const skuInput = interaction.options.getString('skus', true);
  const delivery = interaction.options.getString('delivery', true) as 'dm' | 'channel';
  const channel = interaction.options.getChannel('channel');
  const { valid, invalid } = parseSkuList(skuInput);

  if (delivery === 'channel' && !channel) {
    await interaction.reply({
      content: '❌ You must specify a channel when using "In Channel" delivery.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (valid.length === 0) {
    await interaction.reply({
      content: '❌ Please provide at least one valid SKU.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channelId = delivery === 'channel' ? channel!.id : null;
  const priceDropPercent = interaction.options.getNumber('price_drop');
  const priceSpikePercent = interaction.options.getNumber('price_spike');
  const thresholds = {
    priceDropThreshold: priceDropPercent !== null ? priceDropPercent / 100 : undefined,
    priceSpikeThreshold: priceSpikePercent !== null ? priceSpikePercent / 100 : undefined,
  };

  const results = db.addSkuSubscriptions(interaction.user.id, valid, delivery, channelId, thresholds);

  const addedText = results.added.length > 0
    ? `✅ Subscribed to ${formatSkuList(results.added)} ${delivery === 'dm' ? 'via DM' : `in <#${channelId}>`}.`
    : '';
  const skippedText = results.duplicates.length > 0
    ? `⚠️ Already subscribed: ${formatSkuList(results.duplicates)}.`
    : '';
  const invalidText = invalid.length > 0
    ? `❌ Invalid SKUs: ${formatSkuList(invalid)}.`
    : '';

  await interaction.reply({
    content: [addedText, skippedText, invalidText].filter(Boolean).join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRemove(
  interaction: ChatInputCommandInteraction,
  db: Database
): Promise<void> {
  const skuInput = interaction.options.getString('skus', true);
  const { valid, invalid } = parseSkuList(skuInput);

  if (valid.length === 0) {
    await interaction.reply({
      content: '❌ Please provide at least one valid SKU.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const results = db.removeSkuSubscriptions(interaction.user.id, valid);
  const removedText = results.removed.length > 0
    ? `✅ Removed subscriptions for ${formatSkuList(results.removed)}.`
    : '';
  const missingText = results.missing.length > 0
    ? `⚠️ Not subscribed: ${formatSkuList(results.missing)}.`
    : '';
  const invalidText = invalid.length > 0
    ? `❌ Invalid SKUs: ${formatSkuList(invalid)}.`
    : '';

  await interaction.reply({
    content: [removedText, missingText, invalidText].filter(Boolean).join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  db: Database
): Promise<void> {
  const subscriptions = db.getUserSubscriptions(interaction.user.id);

  if (subscriptions.length === 0) {
    await interaction.reply({
      content: 'You have no active SKU subscriptions. Use `/alert add` to subscribe.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = subscriptions.map(sub => {
    const deliveryText = sub.delivery_method === 'dm'
      ? '(DM)'
      : `(<#${sub.channel_id}>)`;
    const thresholds = [
      sub.price_drop_threshold !== null ? `drop ${Math.round(sub.price_drop_threshold * 100)}%` : null,
      sub.price_spike_threshold !== null ? `spike ${Math.round(sub.price_spike_threshold * 100)}%` : null,
    ].filter(Boolean).join(', ');
    const thresholdText = thresholds ? ` [${thresholds}]` : '';
    return `• **${sub.sku}** ${deliveryText}${thresholdText}`;
  });

  const prefs = db.getUserPreferences(interaction.user.id);
  const quietText = prefs && (prefs.quiet_start_hour !== null || prefs.quiet_end_hour !== null)
    ? `Quiet hours: ${prefs.quiet_start_hour ?? '--'} to ${prefs.quiet_end_hour ?? '--'}`
    : 'Quiet hours: not set';

  await interaction.reply({
    content: `**Your SKU Subscriptions:**\n${lines.join('\n')}\n\n${quietText}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleQuiet(
  interaction: ChatInputCommandInteraction,
  db: Database
): Promise<void> {
  const start = interaction.options.getInteger('start');
  const end = interaction.options.getInteger('end');

  if (start === null && end === null) {
    db.upsertUserPreferences(interaction.user.id, null, null);
    await interaction.reply({
      content: '✅ Quiet hours cleared. Alerts will be sent at any time.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (start === null || end === null) {
    await interaction.reply({
      content: '❌ Please provide both start and end hours (0-23).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  db.upsertUserPreferences(interaction.user.id, start, end);
  await interaction.reply({
    content: `✅ Quiet hours set from ${start}:00 to ${end}:00 (local time).`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleTest(
  interaction: ChatInputCommandInteraction,
  db: Database
): Promise<void> {
  const skuInput = interaction.options.getString('sku', true);
  const { valid, invalid } = parseSkuList(skuInput);

  if (valid.length === 0) {
    const invalidText = invalid.length > 0 ? ` Invalid: ${formatSkuList(invalid)}.` : '';
    await interaction.reply({
      content: `❌ Please provide a valid SKU.${invalidText}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sku = valid[0]!;
  const type = interaction.options.getString('type', true) as AlertType;

  try {
    let products;
    try {
      products = await new OnlyDrivesApi().fetchProducts();
    } catch {
      products = db.getCachedProducts();
    }

    const product = products.find(item => item.sku.toUpperCase() === sku.toUpperCase());

    if (!product) {
      await interaction.reply({
        content: `❌ No product found for **${sku}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const currentPrice = parseFloat(product.current_price_total);
    const previousPrice = currentPrice * 1.1;

    const alert: AlertEvent = {
      type,
      product,
      currentPrice,
      previousPrice: type === 'price_drop' || type === 'price_spike' ? previousPrice : undefined,
      percentChange: type === 'price_drop' || type === 'price_spike'
        ? (currentPrice - previousPrice) / previousPrice
        : undefined,
    };

    await interaction.reply({
      content: 'Here is a preview of your alert:',
      embeds: [createAlertEmbed(alert)],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error('[Alert] Preview failed:', error);
    await interaction.reply({
      content: '❌ Failed to load product data for preview.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
