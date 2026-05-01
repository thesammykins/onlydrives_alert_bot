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

const EMBED_FIELD_VALUE_LIMIT = 1024;
const EMBED_FIELD_SOFT_LIMIT = 1000;
const PRODUCT_TITLE_LIMIT = 58;
const PRODUCT_SKU_LIMIT = 44;

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
  previousPerTbAud: number | null;
  perTbSavingsAud: number | null;
  perTbPercentChange: number | null;
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
    const availableRows = rows.filter(row => row.product.available);
    const bestValue = availableRows
      .filter(row => row.product.available && row.normalizedPerTbAud !== null)
      .sort((a, b) => a.normalizedPerTbAud! - b.normalizedPerTbAud!)
      .slice(0, 5);
    const betterValue = availableRows
      .filter(row => row.perTbSavingsAud !== null && row.perTbSavingsAud > 0)
      .sort((a, b) => {
        const savingsDifference = b.perTbSavingsAud! - a.perTbSavingsAud!;
        return savingsDifference === 0
          ? a.normalizedPerTbAud! - b.normalizedPerTbAud!
          : savingsDifference;
      });

    const embed = new EmbedBuilder()
      .setColor(0x00a3ff)
      .setTitle(`💾 OnlyDrives ${formatSummaryFrequency(settings.frequency)} Value Digest`)
      .setDescription([
        `🗓️ ${period.label}`,
        `🌏 ${settings.timezone}`,
        formatRateLine(rate),
        `📦 ${availableRows.length}/${rows.length} available • 📉 ${betterValue.length} better-value moves`,
      ].join('\n'))
      .setTimestamp(now)
      .setFooter({ text: 'OnlyDrives Monitor' });

    if (rows.length === 0) {
      embed.addFields({ name: 'No Product Data', value: 'No products are available for this summary window.' });
      return { embed, period };
    }

    embed.addFields({
      name: '🏆 Best $/TB Right Now (Top 5)',
      value: bestValue.length > 0
        ? formatRows(bestValue, formatBestValueRow)
        : 'No available products with comparable $/TB pricing.',
    });

    if (betterValue.length > 0) {
      embed.addFields({
        name: formatBetterValueFieldName(settings.frequency),
        value: formatRows(betterValue, formatBetterValueRow),
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
      const valueChange = calculatePerTbValueChange(product, history, period, normalizedPerTbAud, rate);
      const firstSeenAt = new Date(product.first_seen_at).getTime();
      const isNew = firstSeenAt >= period.start.getTime() && firstSeenAt < period.end.getTime();

      return {
        product,
        currentTotal,
        currentPerTb,
        normalizedTotalAud,
        normalizedPerTbAud,
        previousPerTbAud: valueChange.previousPerTbAud,
        perTbSavingsAud: valueChange.savingsAud,
        perTbPercentChange: valueChange.percentChange,
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

function calculatePerTbValueChange(
  product: Product,
  history: PriceHistoryEntry[],
  period: SummaryPeriod,
  currentPerTbAud: number | null,
  rate: ExchangeRate | null
): {
  previousPerTbAud: number | null;
  savingsAud: number | null;
  percentChange: number | null;
} {
  if (currentPerTbAud === null || currentPerTbAud <= 0) {
    return { previousPerTbAud: null, savingsAud: null, percentChange: null };
  }

  const sorted = history
    .map(entry => ({ ...entry, timestamp: new Date(entry.recorded_at).getTime() }))
    .filter(entry => !Number.isNaN(entry.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const periodStart = period.start.getTime();
  const periodEnd = period.end.getTime();
  const startEntry = [...sorted].reverse().find(entry => entry.timestamp <= periodStart)
    ?? sorted.find(entry => entry.timestamp >= periodStart && entry.timestamp < periodEnd);

  if (!startEntry) {
    return { previousPerTbAud: null, savingsAud: null, percentChange: null };
  }

  const previousPerTb = parsePrice(startEntry.price_per_tb);
  const previousPerTbAud = normalizePerTbAud(product, previousPerTb, rate);

  if (previousPerTbAud === null || previousPerTbAud <= 0) {
    return { previousPerTbAud: null, savingsAud: null, percentChange: null };
  }

  return {
    previousPerTbAud,
    savingsAud: previousPerTbAud - currentPerTbAud,
    percentChange: (currentPerTbAud - previousPerTbAud) / previousPerTbAud,
  };
}

function normalizePerTbAud(product: Product, perTb: number, rate: ExchangeRate | null): number | null {
  if (perTb <= 0) {
    return null;
  }

  if (isEastDigitalProduct(product)) {
    return rate ? perTb * rate.rate : null;
  }

  return perTb;
}

function formatRows(
  rows: ProductSummaryRow[],
  rowFormatter: (row: ProductSummaryRow, index: number) => string
): string {
  const lines = rows.map((row, index) => rowFormatter(row, index + 1));
  const selected: string[] = [];
  let value = '';

  for (const line of lines) {
    const nextValue = value ? `${value}\n\n${line}` : line;
    if (nextValue.length > EMBED_FIELD_SOFT_LIMIT) {
      break;
    }

    selected.push(line);
    value = nextValue;
  }

  if (selected.length === 0 && lines[0]) {
    selected.push(truncateText(lines[0], EMBED_FIELD_SOFT_LIMIT));
  }

  if (selected.length < lines.length) {
    const remainingText = `...and ${lines.length - selected.length} more`;
    const nextValue = selected.length > 0
      ? `${selected.join('\n\n')}\n\n${remainingText}`
      : remainingText;

    if (nextValue.length <= EMBED_FIELD_VALUE_LIMIT) {
      selected.push(remainingText);
    }
  }

  return truncateText(selected.join('\n\n'), EMBED_FIELD_VALUE_LIMIT);
}

function formatBestValueRow(row: ProductSummaryRow, index: number): string {
  const product = row.product;

  return [
    `**${index}. ${formatProductLink(product)}**`,
    formatProductMeta(row),
    `🏷️ ${formatCurrentPerTb(row)} • ${formatCurrentTotal(row)}${formatCompactTrend(row)}`,
  ].join('\n');
}

function formatBetterValueRow(row: ProductSummaryRow, index: number): string {
  const product = row.product;
  const previousPerTb = row.previousPerTbAud === null
    ? 'previous n/a'
    : `was A$${row.previousPerTbAud.toFixed(2)}/TB`;
  const savings = row.perTbSavingsAud === null
    ? 'saving n/a'
    : `save A$${row.perTbSavingsAud.toFixed(2)}/TB`;

  return [
    `**${index}. ${formatProductLink(product)}**`,
    formatProductMeta(row),
    `📉 ${formatCurrentPerTb(row)} • ${previousPerTb} • ${savings}${formatCompactTrend(row)}`,
  ].join('\n');
}

function formatProductLink(product: Product): string {
  return `[${formatProductTitle(product)}](${escapeMarkdownUrl(product.url)})`;
}

function formatProductMeta(row: ProductSummaryRow): string {
  const product = row.product;
  const statusParts = [
    `\`${escapeInlineCode(truncateMiddle(product.sku, PRODUCT_SKU_LIMIT))}\``,
    formatCapacity(product.capacity_tb),
    truncateText(product.condition, 26),
    formatSourceName(product.source),
    product.available ? null : 'out of stock',
    row.isNew ? 'new' : null,
    row.isRestocked ? 'restocked' : null,
  ].filter((part): part is string => Boolean(part));

  return statusParts.join(' • ');
}

function formatProductTitle(product: Product): string {
  let title = normalizeWhitespace(product.name);

  for (const token of getSkuNoiseTokens(product.sku)) {
    title = title.replace(new RegExp(escapeRegExp(token), 'gi'), ' ');
  }

  title = title
    .replace(/\bSATA\s+CMR\b/gi, ' ')
    .replace(/\bRecertified\s+neology\b/gi, ' ')
    .replace(/\s+-\s+/g, ' ')
    .replace(/[|()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  title = dedupeCapacityText(title);

  if (!title) {
    title = `${formatSourceName(product.source)} ${formatCapacity(product.capacity_tb)} ${product.type}`;
  }

  return escapeMarkdownText(truncateText(title, PRODUCT_TITLE_LIMIT));
}

function getSkuNoiseTokens(sku: string): string[] {
  const tokens = new Set<string>([sku]);
  const withoutUsedPrefix = sku.replace(/^U-/i, '');
  const withoutRecertifiedSuffix = sku.replace(/-R$/i, '');
  tokens.add(withoutUsedPrefix);
  tokens.add(withoutRecertifiedSuffix);

  for (const match of sku.matchAll(/[A-Z]{1,5}\d{4,}[A-Z0-9]*/gi)) {
    tokens.add(match[0]);
  }

  return [...tokens].filter(token => token.length >= 5);
}

function dedupeCapacityText(value: string): string {
  const seen = new Set<string>();

  return value
    .replace(/\b(\d+(?:\.\d+)?)\s*TB\b/gi, (_match, amountText: string) => {
      const amount = Number(amountText);
      if (!Number.isFinite(amount)) {
        return `${amountText}TB`;
      }

      const key = amount.toFixed(2);
      if (seen.has(key)) {
        return ' ';
      }

      seen.add(key);
      return `${formatCompactNumber(amount)}TB`;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function formatCurrentPerTb(row: ProductSummaryRow): string {
  if (isEastDigitalProduct(row.product)) {
    if (row.normalizedPerTbAud === null) {
      return `US$${row.currentPerTb.toFixed(2)}/TB`;
    }

    return `~A$${row.normalizedPerTbAud.toFixed(2)}/TB (US$${row.currentPerTb.toFixed(2)})`;
  }

  return `A$${row.currentPerTb.toFixed(2)}/TB`;
}

function formatCurrentTotal(row: ProductSummaryRow): string {
  if (isEastDigitalProduct(row.product)) {
    if (row.normalizedTotalAud === null) {
      return `US$${row.currentTotal.toFixed(2)} total`;
    }

    return `~A$${row.normalizedTotalAud.toFixed(2)} total (US$${row.currentTotal.toFixed(2)})`;
  }

  return `A$${row.currentTotal.toFixed(2)} total`;
}

function formatRateLine(rate: ExchangeRate | null): string {
  if (!rate) {
    return '💱 USD -> AUD unavailable';
  }

  const staleText = rate.stale ? ', cached fallback' : '';
  return `💱 USD -> AUD ${rate.rate.toFixed(4)} (${rate.rateDate}${staleText})`;
}

function formatCompactTrend(row: ProductSummaryRow): string {
  if (row.perTbPercentChange === null) {
    return '';
  }

  if (Math.abs(row.perTbPercentChange) < 0.001) {
    return ' • flat';
  }

  const arrow = row.perTbPercentChange > 0 ? '↗️' : '↘️';
  return ` • ${arrow} ${Math.abs(row.perTbPercentChange * 100).toFixed(1)}%`;
}

function formatBetterValueFieldName(frequency: SummaryFrequency): string {
  if (frequency === 'weekly') {
    return '📉 Better Value This Week';
  }

  if (frequency === 'monthly') {
    return '📉 Better Value This Month';
  }

  return '📉 Better Value Than Yesterday';
}

function formatCapacity(capacityTb: string): string {
  const parsed = parsePrice(capacityTb);
  if (parsed <= 0) {
    return `${capacityTb}TB`;
  }

  return `${formatCompactNumber(parsed)}TB`;
}

function formatSourceName(source: string): string {
  return source
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/\.?0+$/, '');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  if (limit <= 3) {
    return value.slice(0, limit);
  }

  return `${value.slice(0, limit - 3).trimEnd()}...`;
}

function truncateMiddle(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  const available = limit - 3;
  const head = Math.ceil(available / 2);
  const tail = Math.floor(available / 2);
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, "'");
}

function escapeMarkdownText(value: string): string {
  return value.replace(/[*_~`]/g, '');
}

function escapeMarkdownUrl(value: string): string {
  return value.replace(/\)/g, '%29').replace(/\s/g, '%20');
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
