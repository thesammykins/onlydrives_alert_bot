import { EmbedBuilder } from 'discord.js';
import type {
  EnabledSummarySettings,
  ExchangeRate,
  PriceHistoryEntry,
  Product,
  SummaryFrequency,
} from '../types.js';
import { OnlyDrivesApi } from './api.js';
import { CurrencyService } from './currency.js';
import { Database } from './database.js';

const SUMMARY_DROP_THRESHOLD = 0.05;
const SUMMARY_SPIKE_THRESHOLD = 0.10;

export interface SummaryPeriod {
  start: Date;
  end: Date;
  label: string;
  trendLabel: string;
}

interface ProductSummaryRow {
  product: Product;
  currentTotal: number;
  currentPerTb: number;
  normalizedTotalAud: number | null;
  normalizedPerTbAud: number | null;
  percentChange: number | null;
  trendText: string;
  isNew: boolean;
  isRestocked: boolean;
}

export class SummaryService {
  private db: Database;
  private api: OnlyDrivesApi;
  private currency: CurrencyService;

  constructor(
    db: Database,
    api = new OnlyDrivesApi(),
    currency = new CurrencyService(db)
  ) {
    this.db = db;
    this.api = api;
    this.currency = currency;
  }

  async buildSummary(settings: EnabledSummarySettings, now = new Date()): Promise<{
    embed: EmbedBuilder;
    period: SummaryPeriod;
  }> {
    const period = getSummaryPeriod(settings.frequency, settings.timezone, now);
    const rate = await this.currency.getUsdToAudRate();
    const products = await this.fetchProducts();
    const rows = await this.buildRows(settings.guildId, products, period, rate);
    const botSettings = this.db.getBotSettings(settings.guildId);
    const dropThreshold = botSettings.priceDropThreshold ?? SUMMARY_DROP_THRESHOLD;
    const spikeThreshold = botSettings.priceSpikeThreshold ?? SUMMARY_SPIKE_THRESHOLD;

    const drops = rows
      .filter(row => row.percentChange !== null && row.percentChange <= -dropThreshold)
      .sort((a, b) => a.percentChange! - b.percentChange!)
      .slice(0, 5);
    const spikes = rows
      .filter(row => row.percentChange !== null && row.percentChange >= spikeThreshold)
      .sort((a, b) => b.percentChange! - a.percentChange!)
      .slice(0, 3);
    const newOrRestocked = rows
      .filter(row => row.isNew || row.isRestocked)
      .sort((a, b) => b.currentTotal - a.currentTotal)
      .slice(0, 5);
    const bestValue = rows
      .filter(row => row.product.available && row.normalizedPerTbAud !== null)
      .sort((a, b) => a.normalizedPerTbAud! - b.normalizedPerTbAud!)
      .slice(0, 5);

    const embed = new EmbedBuilder()
      .setColor(0x00a3ff)
      .setTitle(`OnlyDrives ${formatSummaryFrequency(settings.frequency)} Summary`)
      .setDescription([
        `Period: ${period.label}`,
        `Timezone: ${settings.timezone}`,
        formatRateLine(rate),
      ].join('\n'))
      .setTimestamp(now)
      .setFooter({ text: 'OnlyDrives Monitor' });

    if (rows.length === 0) {
      embed.addFields({ name: 'No Product Data', value: 'No products are available for this summary window.' });
      return { embed, period };
    }

    if (drops.length > 0) {
      embed.addFields({ name: 'Price Drops', value: formatRows(drops) });
    }

    if (spikes.length > 0) {
      embed.addFields({ name: 'Price Increases', value: formatRows(spikes) });
    }

    if (newOrRestocked.length > 0) {
      embed.addFields({ name: 'New / Restocked', value: formatRows(newOrRestocked) });
    }

    if (drops.length === 0 && spikes.length === 0) {
      embed.addFields({
        name: 'Best Value Right Now',
        value: bestValue.length > 0 ? formatRows(bestValue) : 'No available products found.',
      });
    }

    return { embed, period };
  }

  private async fetchProducts(): Promise<Product[]> {
    try {
      const products = await this.api.fetchProducts();
      this.db.upsertCachedProducts(products);
      return products;
    } catch {
      return this.db.getCachedProducts();
    }
  }

  private async buildRows(
    guildId: string,
    products: Product[],
    period: SummaryPeriod,
    rate: ExchangeRate | null
  ): Promise<ProductSummaryRow[]> {
    const restockedIds = new Set(
      this.db
        .getAlertLogs(guildId, ['back_in_stock'], period.start.toISOString(), period.end.toISOString())
        .map(log => log.productId)
    );

    return Promise.all(products.map(async product => {
      const history = await this.fetchHistory(product);
      const currentTotal = parsePrice(product.current_price_total);
      const currentPerTb = parsePrice(product.current_price_per_tb);
      const isEastDigital = isEastDigitalProduct(product);
      const normalizedTotalAud = isEastDigital
        ? this.currency.convertUsdToAud(currentTotal, rate)
        : currentTotal;
      const normalizedPerTbAud = isEastDigital
        ? this.currency.convertUsdToAud(currentPerTb, rate)
        : currentPerTb;
      const percentChange = calculatePercentChange(product, history, period);
      const firstSeenAt = new Date(product.first_seen_at).getTime();
      const isNew = firstSeenAt >= period.start.getTime() && firstSeenAt < period.end.getTime();

      return {
        product,
        currentTotal,
        currentPerTb,
        normalizedTotalAud,
        normalizedPerTbAud,
        percentChange,
        trendText: formatTrend(percentChange, period.trendLabel),
        isNew,
        isRestocked: restockedIds.has(product.id),
      };
    }));
  }

  private async fetchHistory(product: Product): Promise<PriceHistoryEntry[]> {
    try {
      return await this.api.fetchPriceHistory(product.source, product.sku);
    } catch {
      return [];
    }
  }
}

export function isValidSummaryTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getSummaryPeriod(frequency: SummaryFrequency, timezone: string, now: Date): SummaryPeriod {
  if (frequency === 'daily') {
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return {
      start,
      end: now,
      label: `${formatZonedDateTime(start, timezone)} to ${formatZonedDateTime(now, timezone)}`,
      trendLabel: '24h',
    };
  }

  if (frequency === 'weekly') {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return {
      start,
      end: now,
      label: `${formatZonedDateTime(start, timezone)} to ${formatZonedDateTime(now, timezone)}`,
      trendLabel: '7d',
    };
  }

  const parts = getZonedParts(now, timezone);
  const currentMonthStart = zonedDateTimeToUtc(parts.year, parts.month, 1, 0, 0, timezone);
  const previousMonth = parts.month === 1 ? 12 : parts.month - 1;
  const previousYear = parts.month === 1 ? parts.year - 1 : parts.year;
  const previousMonthStart = zonedDateTimeToUtc(previousYear, previousMonth, 1, 0, 0, timezone);

  return {
    start: previousMonthStart,
    end: currentMonthStart,
    label: `${formatZonedDateTime(previousMonthStart, timezone)} to ${formatZonedDateTime(currentMonthStart, timezone)}`,
    trendLabel: '30d',
  };
}

export function formatSummaryFrequency(frequency: SummaryFrequency): string {
  return frequency.charAt(0).toUpperCase() + frequency.slice(1);
}

export function getZonedParts(date: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
} {
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: String(parts.weekday),
  };
}

function calculatePercentChange(
  product: Product,
  history: PriceHistoryEntry[],
  period: SummaryPeriod
): number | null {
  const sorted = history
    .map(entry => ({ ...entry, timestamp: new Date(entry.recorded_at).getTime() }))
    .filter(entry => !Number.isNaN(entry.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const periodStart = period.start.getTime();
  const periodEnd = period.end.getTime();
  const startEntry = [...sorted].reverse().find(entry => entry.timestamp <= periodStart)
    ?? sorted.find(entry => entry.timestamp >= periodStart && entry.timestamp < periodEnd);
  const endEntry = [...sorted].reverse().find(entry => entry.timestamp <= periodEnd);

  if (!startEntry) {
    return null;
  }

  const startPrice = parsePrice(startEntry.price_total);
  const endPrice = endEntry ? parsePrice(endEntry.price_total) : parsePrice(product.current_price_total);

  if (startPrice <= 0 || endPrice <= 0) {
    return null;
  }

  return (endPrice - startPrice) / startPrice;
}

function formatRows(rows: ProductSummaryRow[]): string {
  const lines = rows.map(row => `- ${formatProductLine(row)}`);
  const selected: string[] = [];
  let totalLength = 0;

  for (const line of lines) {
    if (totalLength + line.length + 1 > 1000) {
      break;
    }

    selected.push(line);
    totalLength += line.length + 1;
  }

  if (selected.length < lines.length) {
    selected.push(`...and ${lines.length - selected.length} more`);
  }

  return selected.join('\n');
}

function formatProductLine(row: ProductSummaryRow): string {
  const product = row.product;
  const shortName = product.name.replace(/\s+/g, ' ').slice(0, 56);
  const stock = product.available ? '' : ' (out of stock)';
  const status = [
    row.isNew ? 'new' : null,
    row.isRestocked ? 'restocked' : null,
  ].filter(Boolean).join(', ');
  const statusText = status ? `, ${status}` : '';

  return `[${product.sku}](${product.url}) ${shortName} - ${product.capacity_tb}TB ${product.condition} ${product.source}${stock}${statusText} - ${formatPrice(row)} - ${row.trendText}`;
}

function formatPrice(row: ProductSummaryRow): string {
  if (isEastDigitalProduct(row.product)) {
    if (row.normalizedTotalAud === null || row.normalizedPerTbAud === null) {
      return `$${row.currentTotal.toFixed(2)} USD, $${row.currentPerTb.toFixed(2)}/TB USD (AUD unavailable)`;
    }

    return `$${row.currentTotal.toFixed(2)} USD (~A$${row.normalizedTotalAud.toFixed(2)}), ` +
      `$${row.currentPerTb.toFixed(2)}/TB USD (~A$${row.normalizedPerTbAud.toFixed(2)}/TB)`;
  }

  return `A$${row.currentTotal.toFixed(2)}, A$${row.currentPerTb.toFixed(2)}/TB`;
}

function formatRateLine(rate: ExchangeRate | null): string {
  if (!rate) {
    return 'USD -> AUD estimate unavailable';
  }

  const staleText = rate.stale ? ', cached fallback' : '';
  return `USD -> AUD estimate: ${rate.rate.toFixed(4)} (${rate.rateDate}${staleText})`;
}

function formatTrend(percentChange: number | null, trendLabel: string): string {
  if (percentChange === null) {
    return `${trendLabel} trend unavailable`;
  }

  if (Math.abs(percentChange) < 0.001) {
    return `${trendLabel} flat`;
  }

  const sign = percentChange > 0 ? '+' : '';
  return `${trendLabel} ${sign}${(percentChange * 100).toFixed(1)}%`;
}

function formatZonedDateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const firstOffset = getTimezoneOffsetMs(utcGuess, timezone);
  const adjusted = new Date(utcGuess.getTime() - firstOffset);
  const secondOffset = getTimezoneOffsetMs(adjusted, timezone);
  return new Date(utcGuess.getTime() - secondOffset);
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const parts = getZonedParts(date, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return asUtc - date.getTime();
}

function isEastDigitalProduct(product: Product): boolean {
  return product.source.toLowerCase() === 'east-digital';
}

function parsePrice(value: string): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
