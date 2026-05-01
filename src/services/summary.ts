import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { Resvg } from '@resvg/resvg-js';
import type {
  EnabledSummarySettings,
  ExchangeRate,
  PriceHistoryEntry,
  Product,
  SummaryFrequency,
  SummaryLayout,
} from '../types.js';
import { OnlyDrivesApi } from './api.js';
import { CurrencyService } from './currency.js';
import { Database } from './database.js';

const EMBED_FIELD_VALUE_LIMIT = 1024;
const EMBED_FIELD_SOFT_LIMIT = 1000;
const PRODUCT_TITLE_LIMIT = 58;
const PRODUCT_SKU_LIMIT = 44;
const IMAGE_SUMMARY_WIDTH = 1200;
const IMAGE_SUMMARY_FILENAME = 'onlydrives-summary.png';

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
    files?: AttachmentBuilder[];
  }> {
    const period = getSummaryPeriod(settings.frequency, settings.timezone, now);
    const isCompact = settings.layout === 'compact';
    const isImage = settings.layout === 'image';
    const rate = await this.currency.getUsdToAudRate();
    const products = await this.fetchProducts();
    const rows = await this.buildRows(settings.guildId, products, period, rate);
    const availableRows = rows.filter(row => row.product.available);
    const allBestValue = availableRows
      .filter(row => row.product.available && row.normalizedPerTbAud !== null)
      .sort((a, b) => a.normalizedPerTbAud! - b.normalizedPerTbAud!);
    const allBetterValue = availableRows
      .filter(row => row.perTbSavingsAud !== null && row.perTbSavingsAud > 0)
      .sort((a, b) => {
        const savingsDifference = b.perTbSavingsAud! - a.perTbSavingsAud!;
        return savingsDifference === 0
          ? a.normalizedPerTbAud! - b.normalizedPerTbAud!
          : savingsDifference;
      });
    const bestValue = allBestValue.slice(0, 5);
    const betterValue = allBetterValue.slice(0, isCompact ? 5 : allBetterValue.length);

    const embed = new EmbedBuilder()
      .setColor(0x00a3ff)
      .setTitle(`💾 OnlyDrives ${formatSummaryFrequency(settings.frequency)} ${isCompact ? 'Summary' : 'Value Digest'}`)
      .setDescription([
        `🗓️ ${period.label}`,
        `🌏 ${settings.timezone}`,
        formatRateLine(rate),
        `📦 ${availableRows.length}/${rows.length} available • 📉 ${allBetterValue.length} better-value moves • ${formatSummaryLayout(settings.layout)}`,
      ].join('\n'))
      .setTimestamp(now)
      .setFooter({ text: 'OnlyDrives Monitor' });

    if (rows.length === 0) {
      embed.addFields({ name: 'No Product Data', value: 'No products are available for this summary window.' });
      return { embed, period };
    }

    if (isImage) {
      const png = renderSummaryImage({
        frequency: settings.frequency,
        periodLabel: period.label,
        timezone: settings.timezone,
        rate,
        availableCount: availableRows.length,
        totalCount: rows.length,
        betterValueCount: allBetterValue.length,
        bestValue,
        betterValue,
      });
      const attachment = new AttachmentBuilder(png, {
        name: IMAGE_SUMMARY_FILENAME,
        description: 'OnlyDrives product summary image',
      });

      embed
        .setTitle(`💾 OnlyDrives ${formatSummaryFrequency(settings.frequency)} Image Summary`)
        .setImage(`attachment://${IMAGE_SUMMARY_FILENAME}`)
        .addFields({
          name: '🔗 Store Links',
          value: formatImageSummaryLinks(bestValue, betterValue),
        });

      return { embed, period, files: [attachment] };
    }

    if (isCompact) {
      embed.addFields({
        name: '🏆 Best Value Now',
        value: bestValue.length > 0
          ? formatRows(bestValue, formatCompactBestValueRow)
          : 'No available products with comparable $/TB pricing.',
      });

      embed.addFields({
        name: formatCompactBetterValueFieldName(settings.frequency),
        value: betterValue.length > 0
          ? formatRows(betterValue, formatCompactBetterValueRow)
          : 'No better-value moves in this summary window.',
      });
    } else {
      embed.addFields({
        name: '🏆 Best $/TB Right Now (Top 5)',
        value: bestValue.length > 0
          ? formatRows(bestValue, formatDetailedBestValueRow)
          : 'No available products with comparable $/TB pricing.',
      });

      if (betterValue.length > 0) {
        embed.addFields({
          name: formatDetailedBetterValueFieldName(settings.frequency),
          value: formatRows(betterValue, formatDetailedBetterValueRow),
        });
      }
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

export function formatSummaryLayout(layout: SummaryLayout): string {
  return layout.charAt(0).toUpperCase() + layout.slice(1);
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

function renderSummaryImage(input: {
  frequency: SummaryFrequency;
  periodLabel: string;
  timezone: string;
  rate: ExchangeRate | null;
  availableCount: number;
  totalCount: number;
  betterValueCount: number;
  bestValue: ProductSummaryRow[];
  betterValue: ProductSummaryRow[];
}): Buffer {
  const bestRows = input.bestValue.slice(0, 5);
  const betterRows = input.betterValue.slice(0, 5);
  const rowHeight = 84;
  const headerHeight = 172;
  const sectionGap = 28;
  const bestHeight = 54 + Math.max(bestRows.length, 1) * rowHeight;
  const betterHeight = 54 + Math.max(betterRows.length, 1) * rowHeight;
  const height = headerHeight + bestHeight + sectionGap + betterHeight + 52;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_SUMMARY_WIDTH}" height="${height}" viewBox="0 0 ${IMAGE_SUMMARY_WIDTH} ${height}">`,
    '<defs>',
    '<linearGradient id="accent" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#2dd4bf"/><stop offset="1" stop-color="#38bdf8"/></linearGradient>',
    '<filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#020617" flood-opacity="0.32"/></filter>',
    '</defs>',
    rect(0, 0, IMAGE_SUMMARY_WIDTH, height, '#111827'),
    rect(28, 28, IMAGE_SUMMARY_WIDTH - 56, height - 56, '#1f2433', 24, 'filter="url(#shadow)"'),
    rect(28, 28, 10, height - 56, 'url(#accent)', 5),
    text('OnlyDrives', 60, 72, 34, '#f8fafc', 800),
    text(`${formatSummaryFrequency(input.frequency)} Image Summary`, 60, 108, 20, '#93c5fd', 700),
    text(input.periodLabel, 60, 138, 18, '#cbd5e1', 500),
    text(input.timezone, 60, 164, 17, '#94a3b8', 500),
    badge(`${input.availableCount}/${input.totalCount} available`, 690, 61, 190),
    badge(`${input.betterValueCount} better-value moves`, 900, 61, 238),
    text(formatImageRate(input.rate), 690, 128, 18, '#cbd5e1', 600),
  ];

  let y = headerHeight;
  parts.push(sectionHeading('Best $/TB Right Now', 'Ranked by estimated AUD/TB', 60, y));
  y += 54;
  if (bestRows.length === 0) {
    parts.push(emptyImageRow('No available products with comparable pricing.', y));
    y += rowHeight;
  } else {
    bestRows.forEach((row, index) => {
      parts.push(bestValueImageRow(row, index + 1, y));
      y += rowHeight;
    });
  }

  y += sectionGap;
  parts.push(sectionHeading(formatImageBetterValueHeading(input.frequency), 'Current price per TB improved in this summary window', 60, y));
  y += 54;
  if (betterRows.length === 0) {
    parts.push(emptyImageRow('No better-value moves in this summary window.', y));
    y += rowHeight;
  } else {
    betterRows.forEach((row, index) => {
      parts.push(betterValueImageRow(row, index + 1, y));
      y += rowHeight;
    });
  }

  parts.push(text('Generated by OnlyDrives Monitor', 60, height - 38, 15, '#64748b', 500));
  parts.push('</svg>');

  return new Resvg(parts.join(''), {
    fitTo: { mode: 'width', value: IMAGE_SUMMARY_WIDTH },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'DejaVu Sans',
      sansSerifFamily: 'DejaVu Sans',
    },
  }).render().asPng();
}

function bestValueImageRow(row: ProductSummaryRow, index: number, y: number): string {
  const product = row.product;
  const title = formatImageTitle(product, 40);

  return [
    rowBackground(y, index),
    text(String(index), 78, y + 44, 22, '#f8fafc', 800),
    text(title, 122, y + 29, 19, '#93c5fd', 800),
    text(formatImageProductMeta(row, 78), 122, y + 60, 15, '#94a3b8', 500),
    pricePill(formatCompactCurrentPerTb(row), 900, y + 16, 220, 44),
  ].join('');
}

function betterValueImageRow(row: ProductSummaryRow, index: number, y: number): string {
  const product = row.product;
  const title = formatImageTitle(product, 34);

  return [
    rowBackground(y, index),
    text(String(index), 78, y + 44, 22, '#f8fafc', 800),
    text(title, 122, y + 30, 19, '#93c5fd', 800),
    text(`${formatCapacity(product.capacity_tb)} • ${formatSourceName(product.source)} • ${truncateText(product.condition, 20)}`, 122, y + 56, 15, '#94a3b8', 500),
    text(formatPreviousPerTb(row), 560, y + 42, 17, '#cbd5e1', 600, 'end'),
    text(formatCompactCurrentPerTb(row), 720, y + 42, 17, '#fef3c7', 800, 'end'),
    text(formatImageSavings(row), 902, y + 42, 17, '#34d399', 800, 'end'),
    text(formatImageTrend(row), 1100, y + 42, 18, '#34d399', 800, 'end'),
  ].join('');
}

function rowBackground(y: number, index: number): string {
  const fill = index % 2 === 0 ? '#252b3d' : '#22283a';
  return `${rect(60, y, 1080, 74, fill, 14)}${rect(60, y, 4, 74, index <= 3 ? '#38bdf8' : '#475569', 2)}`;
}

function pricePill(value: string, x: number, y: number, width: number, height: number): string {
  return [
    rect(x, y, width, height, '#30384d', 14),
    rect(x, y, 4, height, '#facc15', 2),
    text(value, x + width - 18, y + 29, 19, '#fef3c7', 800, 'end'),
  ].join('');
}

function sectionHeading(title: string, subtitle: string, x: number, y: number): string {
  return [
    text(title, x, y + 24, 24, '#f8fafc', 800),
    text(subtitle, x, y + 49, 16, '#94a3b8', 500),
    line(x, y + 60, IMAGE_SUMMARY_WIDTH - x, y + 60, '#334155'),
  ].join('');
}

function emptyImageRow(value: string, y: number): string {
  return [
    rect(60, y, 1080, 62, '#22283a', 14),
    text(value, 86, y + 39, 18, '#94a3b8', 600),
  ].join('');
}

function formatImageSummaryLinks(bestValue: ProductSummaryRow[], betterValue: ProductSummaryRow[]): string {
  const lines = [
    ...bestValue.slice(0, 5).map((row, index) => `🏆 ${index + 1}. ${formatProductLink(row.product, 38)}`),
    ...betterValue.slice(0, 5).map((row, index) => `📉 ${index + 1}. ${formatProductLink(row.product, 38)}`),
  ];

  if (lines.length === 0) {
    return 'No listing links available for this summary.';
  }

  return truncateText(lines.join('\n'), EMBED_FIELD_VALUE_LIMIT);
}

function formatCompactBestValueRow(row: ProductSummaryRow, index: number): string {
  const product = row.product;

  return [
    `**${index}. ${formatProductLink(product, 46)}**`,
    `🏷️ ${formatCompactCurrentPerTb(row)} • ${formatCompactCurrentTotal(row)}${formatCompactTrend(row)}`,
    `${formatCapacity(product.capacity_tb)} • ${formatSourceName(product.source)} • ${truncateText(product.condition, 18)}`,
  ].join('\n');
}

function formatCompactBetterValueRow(row: ProductSummaryRow, index: number): string {
  const product = row.product;
  const savings = row.perTbSavingsAud === null
    ? ''
    : ` • save A$${row.perTbSavingsAud.toFixed(2)}/TB`;

  return [
    `**${index}. ${formatProductLink(product, 46)}**`,
    `📉 now ${formatCompactCurrentPerTb(row)}${savings}${formatCompactTrend(row)}`,
    `${formatCapacity(product.capacity_tb)} • ${formatSourceName(product.source)} • ${truncateText(product.condition, 18)}`,
  ].join('\n');
}

function formatDetailedBestValueRow(row: ProductSummaryRow, index: number): string {
  const product = row.product;

  return [
    `**${index}. ${formatProductLink(product)}**`,
    formatProductMeta(row),
    `🏷️ ${formatCurrentPerTb(row)} • ${formatCurrentTotal(row)}${formatCompactTrend(row)}`,
  ].join('\n');
}

function formatDetailedBetterValueRow(row: ProductSummaryRow, index: number): string {
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

function formatProductLink(product: Product, titleLimit = PRODUCT_TITLE_LIMIT): string {
  return `[${formatProductTitle(product, titleLimit)}](${escapeMarkdownUrl(product.url)})`;
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

function formatProductTitle(product: Product, titleLimit = PRODUCT_TITLE_LIMIT): string {
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

  return escapeMarkdownText(truncateText(title, titleLimit));
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

function formatCompactCurrentPerTb(row: ProductSummaryRow): string {
  if (isEastDigitalProduct(row.product)) {
    if (row.normalizedPerTbAud === null) {
      return `US$${row.currentPerTb.toFixed(2)}/TB`;
    }

    return `~A$${row.normalizedPerTbAud.toFixed(2)}/TB`;
  }

  return `A$${row.currentPerTb.toFixed(2)}/TB`;
}

function formatCompactCurrentTotal(row: ProductSummaryRow): string {
  if (isEastDigitalProduct(row.product)) {
    if (row.normalizedTotalAud === null) {
      return `US$${row.currentTotal.toFixed(2)}`;
    }

    return `~A$${row.normalizedTotalAud.toFixed(0)}`;
  }

  return `A$${row.currentTotal.toFixed(0)}`;
}

function formatPreviousPerTb(row: ProductSummaryRow): string {
  return row.previousPerTbAud === null
    ? 'was n/a'
    : `was A$${row.previousPerTbAud.toFixed(2)}`;
}

function formatImageSavings(row: ProductSummaryRow): string {
  return row.perTbSavingsAud === null
    ? 'save n/a'
    : `save A$${row.perTbSavingsAud.toFixed(2)}`;
}

function formatImageProductMeta(row: ProductSummaryRow, limit: number): string {
  const product = row.product;
  return truncateText([
    truncateMiddle(product.sku, 26),
    formatCapacity(product.capacity_tb),
    formatSourceName(product.source),
    product.condition,
  ].join(' • '), limit);
}

function formatImageTrend(row: ProductSummaryRow): string {
  if (row.perTbPercentChange === null || Math.abs(row.perTbPercentChange) < 0.001) {
    return 'flat';
  }

  const arrow = row.perTbPercentChange > 0 ? '↑' : '↓';
  return `${arrow} ${Math.abs(row.perTbPercentChange * 100).toFixed(1)}%`;
}

function formatImageRate(rate: ExchangeRate | null): string {
  if (!rate) {
    return 'USD -> AUD unavailable';
  }

  const staleText = rate.stale ? ' cached fallback' : '';
  return `USD -> AUD ${rate.rate.toFixed(4)} (${rate.rateDate}${staleText})`;
}

function formatImageTitle(product: Product, limit: number): string {
  return unescapeMarkdownText(formatProductTitle(product, limit));
}

function formatImageBetterValueHeading(frequency: SummaryFrequency): string {
  if (frequency === 'weekly') {
    return 'Better Value This Week';
  }

  if (frequency === 'monthly') {
    return 'Better Value This Month';
  }

  return 'Better Than Yesterday';
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

function formatCompactBetterValueFieldName(frequency: SummaryFrequency): string {
  if (frequency === 'weekly') {
    return '📉 Better This Week';
  }

  if (frequency === 'monthly') {
    return '📉 Better This Month';
  }

  return '📉 Better Than Yesterday';
}

function formatDetailedBetterValueFieldName(frequency: SummaryFrequency): string {
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

function rect(x: number, y: number, width: number, height: number, fill: string, radius = 0, extra = ''): string {
  const radiusText = radius > 0 ? ` rx="${radius}" ry="${radius}"` : '';
  const extraText = extra ? ` ${extra}` : '';
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}"${radiusText} fill="${fill}"${extraText}/>`;
}

function line(x1: number, y1: number, x2: number, y2: number, stroke: string): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1"/>`;
}

function text(
  value: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  weight: number,
  anchor: 'start' | 'middle' | 'end' = 'start'
): string {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function badge(value: string, x: number, y: number, width: number): string {
  return [
    rect(x, y, width, 34, '#334155', 17),
    text(value, x + width / 2, y + 23, 15, '#e2e8f0', 700, 'middle'),
  ].join('');
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

function unescapeMarkdownText(value: string): string {
  return value.replace(/\\/g, '');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
