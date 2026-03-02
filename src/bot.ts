import { Client, GatewayIntentBits, Events, Collection, Partials, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction, AutocompleteInteraction, Message } from 'discord.js';
import type { Database } from './services/database.js';
import { formatSkuList, parseSkuList } from './utils/sku.js';

export interface Command {
  data: {
    name: string;
    description: string;
    toJSON(): unknown;
  };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

export interface BotClient extends Client {
  commands: Collection<string, Command>;
}

export function createClient(): BotClient {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  }) as BotClient;

  client.commands = new Collection<string, Command>();

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (error) {
          console.error(`[Bot] Autocomplete error:`, error);
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.error(`[Bot] Unknown command: ${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`[Bot] Command error:`, error);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'An error occurred while executing this command.', flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: 'An error occurred while executing this command.', flags: MessageFlags.Ephemeral });
      }
    }
  });

  return client;
}

export function setupMessageHandler(client: BotClient, db: Database): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (!client.user) return;

    const isMentioned = message.mentions.has(client.user.id);
    const isDM = !message.guild;

    if (!isMentioned && !isDM) return;

    const content = message.content
      .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
      .trim()
      .toLowerCase();

    const parts = content.split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    try {
      if (command === 'subscribe' || command === 'watch' || command === 'alert') {
        await handleSubscribeViaMention(message, db, args);
      } else if (command === 'unsubscribe' || command === 'unwatch' || command === 'remove') {
        await handleUnsubscribeViaMention(message, db, args);
      } else if (command === 'list' || command === 'subscriptions') {
        await handleListViaMention(message, db);
      } else if (command === 'help' || command === '') {
        await message.reply(
          '**Available commands:**\n' +
          '• `subscribe <sku1,sku2> [dm|channel]` - Subscribe to alerts\n' +
          '• `unsubscribe <sku1,sku2>` - Remove subscriptions\n' +
          '• `list` - View your subscriptions\n\n' +
          'Or use `/alert` slash command for full options.'
        );
      } else {
        await message.reply(
          `I didn't understand that. Try \`@${client.user.username} help\` for commands.`
        );
      }
    } catch (error) {
      console.error('[Bot] Message handler error:', error);
      await message.reply('An error occurred processing your request.').catch(() => {});
    }
  });
}

async function handleSubscribeViaMention(message: Message, db: Database, args: string[]): Promise<void> {
  const skuArg = args[0];
  if (!skuArg) {
    await message.reply('Please specify a SKU list. Example: `subscribe ST8000DM004,WD80EFAX`');
    return;
  }

  const deliveryArg = args[1]?.toLowerCase();
  let delivery: 'dm' | 'channel' = 'dm';
  let channelId: string | null = null;

  if (deliveryArg === 'channel' || deliveryArg === 'here') {
    if (!message.guild) {
      await message.reply('Channel delivery is only available in servers. Use DM delivery instead.');
      return;
    }
    delivery = 'channel';
    channelId = message.channelId;
  }

  const { valid, invalid } = parseSkuList(skuArg);
  if (valid.length === 0) {
    await message.reply('Please provide at least one valid SKU. Example: `subscribe ST8000DM004`');
    return;
  }

  const results = db.addSkuSubscriptions(message.author.id, valid, delivery, channelId);
  const addedText = results.added.length > 0
    ? `✅ Subscribed to ${formatSkuList(results.added)} ${delivery === 'dm' ? 'via DM' : 'in this channel'}`
    : '';
  const duplicateText = results.duplicates.length > 0
    ? `⚠️ Already subscribed: ${formatSkuList(results.duplicates)}`
    : '';
  const invalidText = invalid.length > 0
    ? `❌ Invalid SKUs: ${formatSkuList(invalid)}`
    : '';

  await message.reply([addedText, duplicateText, invalidText].filter(Boolean).join('\n'));
}

async function handleUnsubscribeViaMention(message: Message, db: Database, args: string[]): Promise<void> {
  const skuArg = args[0];
  if (!skuArg) {
    await message.reply('Please specify a SKU list. Example: `unsubscribe ST8000DM004,WD80EFAX`');
    return;
  }

  const { valid, invalid } = parseSkuList(skuArg);
  if (valid.length === 0) {
    await message.reply('Please provide at least one valid SKU. Example: `unsubscribe ST8000DM004`');
    return;
  }

  const results = db.removeSkuSubscriptions(message.author.id, valid);
  const removedText = results.removed.length > 0
    ? `✅ Removed subscriptions for ${formatSkuList(results.removed)}`
    : '';
  const missingText = results.missing.length > 0
    ? `⚠️ Not subscribed: ${formatSkuList(results.missing)}`
    : '';
  const invalidText = invalid.length > 0
    ? `❌ Invalid SKUs: ${formatSkuList(invalid)}`
    : '';

  await message.reply([removedText, missingText, invalidText].filter(Boolean).join('\n'));
}

async function handleListViaMention(message: Message, db: Database): Promise<void> {
  const subscriptions = db.getUserSubscriptions(message.author.id);

  if (subscriptions.length === 0) {
    await message.reply('You have no active subscriptions.');
    return;
  }

  const lines = subscriptions.map(sub => {
    const deliveryText = sub.delivery_method === 'dm' ? '(DM)' : `(<#${sub.channel_id}>)`;
    return `• **${sub.sku}** ${deliveryText}`;
  });

  await message.reply(`**Your subscriptions:**\n${lines.join('\n')}`);
}
