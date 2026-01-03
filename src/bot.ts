import { Client, GatewayIntentBits, Events, Collection, Partials } from 'discord.js';
import type { ChatInputCommandInteraction, AutocompleteInteraction, Message } from 'discord.js';
import type { Database } from './services/database.js';

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
      const reply = { content: 'An error occurred while executing this command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
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
          '• `subscribe <sku> [dm|channel]` - Subscribe to alerts\n' +
          '• `unsubscribe <sku>` - Remove a subscription\n' +
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
    await message.reply('Please specify a SKU. Example: `subscribe ST8000DM004`');
    return;
  }

  const sku = skuArg.toUpperCase();
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

  const success = db.addSkuSubscription(message.author.id, sku, delivery, channelId);

  if (success) {
    const deliveryText = delivery === 'dm' ? 'via DM' : `in this channel`;
    await message.reply(`✅ Subscribed to price alerts for **${sku}** ${deliveryText}`);
  } else {
    await message.reply(`⚠️ You're already subscribed to **${sku}**`);
  }
}

async function handleUnsubscribeViaMention(message: Message, db: Database, args: string[]): Promise<void> {
  const skuArg = args[0];
  if (!skuArg) {
    await message.reply('Please specify a SKU. Example: `unsubscribe ST8000DM004`');
    return;
  }

  const sku = skuArg.toUpperCase();
  const success = db.removeSkuSubscription(message.author.id, sku);

  if (success) {
    await message.reply(`✅ Removed subscription for **${sku}**`);
  } else {
    await message.reply(`⚠️ You're not subscribed to **${sku}**`);
  }
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
