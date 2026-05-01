import type { Client, TextChannel } from 'discord.js';
import type { EnabledSummarySettings } from '../types.js';
import { Database } from './database.js';
import { getSummaryPeriod, getZonedParts, SummaryService } from './summary.js';

export class SummaryScheduler {
  private client: Client;
  private db: Database;
  private summaryService: SummaryService;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(client: Client, db: Database, summaryService = new SummaryService(db)) {
    this.client = client;
    this.db = db;
    this.summaryService = summaryService;
  }

  start(): void {
    console.log('[SummaryScheduler] Starting summary scheduler');
    this.runDueSummaries().catch(error => {
      console.error('[SummaryScheduler] Error running summaries:', error);
    });

    this.intervalId = setInterval(() => {
      this.runDueSummaries().catch(error => {
        console.error('[SummaryScheduler] Error running summaries:', error);
      });
    }, 60 * 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[SummaryScheduler] Stopped summary scheduler');
    }
  }

  async runDueSummaries(now = new Date()): Promise<number> {
    const settings = this.db.getEnabledSummarySettings();
    let sentCount = 0;

    for (const setting of settings) {
      if (!isSummaryDue(setting, now)) {
        continue;
      }

      const period = getSummaryPeriod(setting.frequency, setting.timezone, now);
      if (this.db.hasSummaryRun(
        setting.guildId,
        setting.frequency,
        period.start.toISOString(),
        period.end.toISOString()
      )) {
        continue;
      }

      const channel = await this.getChannel(setting.channelId);
      if (!channel) {
        console.error(`[SummaryScheduler] Could not find summary channel ${setting.channelId} for ${setting.guildId}`);
        continue;
      }

      const { embed, files } = await this.summaryService.buildSummary(setting, now);
      const message = await channel.send({ embeds: [embed], files });
      const recorded = this.db.recordSummaryRun({
        guildId: setting.guildId,
        frequency: setting.frequency,
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
        channelId: setting.channelId,
        messageId: message.id,
        sentAt: new Date().toISOString(),
      });

      if (recorded) {
        sentCount++;
        console.log(`[SummaryScheduler] Sent ${setting.frequency} summary for ${setting.guildId} to #${channel.name}`);
      }
    }

    return sentCount;
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

export function isSummaryDue(settings: EnabledSummarySettings, now: Date): boolean {
  const parts = getZonedParts(now, settings.timezone);
  const [hourText, minuteText] = settings.time.split(':');
  const expectedHour = Number(hourText);
  const expectedMinute = Number(minuteText);

  if (parts.hour !== expectedHour || parts.minute !== expectedMinute) {
    return false;
  }

  if (settings.frequency === 'weekly' && parts.weekday !== 'Mon') {
    return false;
  }

  if (settings.frequency === 'monthly' && parts.day !== 1) {
    return false;
  }

  return true;
}
