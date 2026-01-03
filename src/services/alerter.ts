import type { Client, TextChannel } from 'discord.js';
import type { AlertEvent, AlertType, BotSettings, Config } from '../types.js';
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
}
