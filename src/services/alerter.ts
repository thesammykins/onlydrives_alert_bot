import type { Client, TextChannel } from 'discord.js';
import type { AlertEvent } from '../types.js';
import { createAlertEmbed } from '../utils/embed.js';
import { Database } from './database.js';

export class Alerter {
  private client: Client;
  private channelId: string;
  private db: Database;
  private cooldownMs: number;

  constructor(client: Client, channelId: string, db: Database, cooldownMs: number) {
    this.client = client;
    this.channelId = channelId;
    this.db = db;
    this.cooldownMs = cooldownMs;
  }

  async sendAlert(alert: AlertEvent): Promise<boolean> {
    const productId = alert.product.id;
    const alertType = alert.type;

    if (!this.db.canSendAlert(productId, alertType, this.cooldownMs)) {
      console.log(`[Alerter] Skipping ${alertType} for ${productId} - cooldown active`);
      return false;
    }

    const channel = await this.getChannel();
    if (!channel) {
      console.error(`[Alerter] Could not find channel ${this.channelId}`);
      return false;
    }

    const embed = createAlertEmbed(alert);

    try {
      await channel.send({ embeds: [embed] });
      this.db.logAlert(productId, alertType);
      console.log(`[Alerter] Sent ${alertType} alert for ${alert.product.sku}`);
      return true;
    } catch (error) {
      console.error(`[Alerter] Failed to send alert:`, error);
      return false;
    }
  }

  private async getChannel(): Promise<TextChannel | null> {
    try {
      const channel = await this.client.channels.fetch(this.channelId);
      if (channel?.isTextBased() && 'send' in channel) {
        return channel as TextChannel;
      }
      return null;
    } catch {
      return null;
    }
  }
}
