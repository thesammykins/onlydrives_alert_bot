import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  AutocompleteInteraction,
} from 'discord.js';
import type { Command } from '../bot.js';
import type { Database } from '../services/database.js';
import { OnlyDrivesApi } from '../services/api.js';

export function createAlertCommand(db: Database): Command {
  const api = new OnlyDrivesApi();

  const data = new SlashCommandBuilder()
    .setName('alert')
    .setDescription('Manage personal price alerts for specific SKUs')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Subscribe to price alerts for a SKU')
        .addStringOption(opt =>
          opt
            .setName('sku')
            .setDescription('Product SKU to watch')
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
        .setDescription('Unsubscribe from price alerts for a SKU')
        .addStringOption(opt =>
          opt
            .setName('sku')
            .setDescription('Product SKU to stop watching')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List your active SKU subscriptions')
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
      }
    },
    async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
      const focused = interaction.options.getFocused().toUpperCase();
      
      try {
        const products = await api.fetchProducts();
        const matches = products
          .filter(p => p.sku.toUpperCase().includes(focused) || p.name.toLowerCase().includes(focused.toLowerCase()))
          .slice(0, 25)
          .map(p => ({
            name: `${p.sku} - ${p.name.slice(0, 80)}`,
            value: p.sku,
          }));

        await interaction.respond(matches);
      } catch {
        await interaction.respond([]);
      }
    },
  };
}

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  db: Database
): Promise<void> {
  const sku = interaction.options.getString('sku', true).toUpperCase();
  const delivery = interaction.options.getString('delivery', true) as 'dm' | 'channel';
  const channel = interaction.options.getChannel('channel');

  if (delivery === 'channel' && !channel) {
    await interaction.reply({
      content: '❌ You must specify a channel when using "In Channel" delivery.',
      ephemeral: true,
    });
    return;
  }

  const channelId = delivery === 'channel' ? channel!.id : null;
  const success = db.addSkuSubscription(interaction.user.id, sku, delivery, channelId);

  if (success) {
    const deliveryText = delivery === 'dm' 
      ? 'via DM' 
      : `in <#${channelId}>`;
    await interaction.reply({
      content: `✅ You will now receive price alerts for **${sku}** ${deliveryText}`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: `⚠️ You are already subscribed to **${sku}**. Use \`/alert remove\` first to change settings.`,
      ephemeral: true,
    });
  }
}

async function handleRemove(
  interaction: ChatInputCommandInteraction,
  db: Database
): Promise<void> {
  const sku = interaction.options.getString('sku', true).toUpperCase();
  const success = db.removeSkuSubscription(interaction.user.id, sku);

  if (success) {
    await interaction.reply({
      content: `✅ Removed subscription for **${sku}**`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: `⚠️ You are not subscribed to **${sku}**`,
      ephemeral: true,
    });
  }
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  db: Database
): Promise<void> {
  const subscriptions = db.getUserSubscriptions(interaction.user.id);

  if (subscriptions.length === 0) {
    await interaction.reply({
      content: 'You have no active SKU subscriptions. Use `/alert add` to subscribe.',
      ephemeral: true,
    });
    return;
  }

  const lines = subscriptions.map(sub => {
    const deliveryText = sub.delivery_method === 'dm' 
      ? '(DM)' 
      : `(<#${sub.channel_id}>)`;
    return `• **${sub.sku}** ${deliveryText}`;
  });

  await interaction.reply({
    content: `**Your SKU Subscriptions:**\n${lines.join('\n')}`,
    ephemeral: true,
  });
}
