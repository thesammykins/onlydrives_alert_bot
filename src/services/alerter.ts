import type { Client, TextChannel, User } from 'discord.js';
import type { AlertEvent, AlertType, BotSettings, Config, SkuSubscription } from '../types.js';
import { createAlertEmbed } from '../utils/embed.js';
import { Database } from './database.js';

export class Alerter {
  private client: Client;
  private defaultChannelId: string;
  private db: Database;
  private defaultCooldownMs: number;
  private envConfig: Config['monitoring'];

  constructor(
    client: Client,
    defaultChannelId: string,
    db: Database,
    envConfig: Config['monitoring']
  ) {
    this.client = client;
    this.defaultChannelId = defaultChannelId;
    this.db = db;
    this.defaultCooldownMs = envConfig.alertCooldownMs;
    this.envConfig = envConfig;
  }

  async sendAlert(alert: AlertEvent): Promise<boolean> {
    const productId = alert.product.id;
    const alertType = alert.type;
    const settings = this.db.getBotSettings();

    if (!this.isAlertTypeEnabled(alertType, settings)) {
      console.log(`[Alerter] Skipping ${alertType} for ${productId} - alert type disabled`);
      return false;
    }

    const cooldownMs = settings.alertCooldownMs ?? this.defaultCooldownMs;
    if (!this.db.canSendAlert(productId, alertType, cooldownMs)) {
      console.log(`[Alerter] Skipping ${alertType} for ${productId} - cooldown active`);
      return false;
    }

    const channelId = this.getChannelForAlertType(alertType, settings);
    const channel = await this.getChannel(channelId);
    if (!channel) {
      console.error(`[Alerter] Could not find channel ${channelId}`);
      return false;
    }

    const embed = createAlertEmbed(alert);

    try {
      await channel.send({ embeds: [embed] });
      this.db.logAlert(productId, alertType);
      console.log(`[Alerter] Sent ${alertType} alert for ${alert.product.sku} to #${channel.name}`);
      return true;
    } catch (error) {
      console.error(`[Alerter] Failed to send alert:`, error);
      return false;
    }
  }

  async sendSubscriptionAlerts(alert: AlertEvent): Promise<number> {
    const sku = alert.product.sku.toUpperCase();
    const subscriptions = this.db.getSubscribersForSku(sku);
    
    if (subscriptions.length === 0) {
      return 0;
    }

    const embed = createAlertEmbed(alert);
    let sentCount = 0;

    for (const sub of subscriptions) {
      try {
        if (sub.delivery_method === 'dm') {
          const user = await this.getUser(sub.user_id);
          if (user) {
            await user.send({ 
              content: `🔔 Price alert for **${sku}**:`,
              embeds: [embed] 
            });
            sentCount++;
            console.log(`[Alerter] Sent subscription alert for ${sku} to user ${user.tag} via DM`);
          }
        } else if (sub.delivery_method === 'channel' && sub.channel_id) {
          const channel = await this.getChannel(sub.channel_id);
          if (channel) {
            await channel.send({ 
              content: `🔔 <@${sub.user_id}> Price alert for **${sku}**:`,
              embeds: [embed] 
            });
            sentCount++;
            console.log(`[Alerter] Sent subscription alert for ${sku} to channel #${channel.name}`);
          }
        }
      } catch (error) {
        console.error(`[Alerter] Failed to send subscription alert to ${sub.user_id}:`, error);
      }
    }

    return sentCount;
  }

  private isAlertTypeEnabled(alertType: AlertType, settings: BotSettings): boolean {
    switch (alertType) {
      case 'price_drop':
        return settings.alertPriceDropEnabled;
      case 'price_spike':
        return settings.alertPriceSpikeEnabled;
      case 'new_product':
        return settings.alertNewProductEnabled;
      case 'back_in_stock':
        return settings.alertBackInStockEnabled;
      default:
        return true;
    }
  }

  private getChannelForAlertType(alertType: AlertType, settings: BotSettings): string {
    switch (alertType) {
      case 'price_drop':
        return settings.channelPriceDrop ?? this.defaultChannelId;
      case 'price_spike':
        return settings.channelPriceSpike ?? this.defaultChannelId;
      case 'new_product':
        return settings.channelNewProduct ?? this.defaultChannelId;
      case 'back_in_stock':
        return settings.channelBackInStock ?? this.defaultChannelId;
      default:
        return this.defaultChannelId;
    }
  }

  private async getChannel(channelId: string): Promise<TextChannel | null> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isTextBased() && 'send' in channel) {
        return channel as TextChannel;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async getUser(userId: string): Promise<User | null> {
    try {
      return await this.client.users.fetch(userId);
    } catch {
      return null;
    }
  }
}
