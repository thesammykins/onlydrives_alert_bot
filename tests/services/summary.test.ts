import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../src/services/database.js';
import { getSummaryPeriod, SummaryService } from '../../src/services/summary.js';
import type { EnabledSummarySettings, ExchangeRate, PriceHistoryEntry, Product } from '../../src/types.js';

const rate: ExchangeRate = {
  baseCurrency: 'USD',
  targetCurrency: 'AUD',
  rate: 1.5,
  rateDate: '2026-04-30',
  fetchedAt: '2026-04-30T00:00:00.000Z',
  stale: false,
};

function createProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: overrides.id ?? 'product-1',
    sku: overrides.sku ?? 'SKU-1',
    name: overrides.name ?? 'Test Drive 10TB',
    type: overrides.type ?? 'HDD',
    condition: overrides.condition ?? 'Recertified',
    capacity_tb: overrides.capacity_tb ?? '10.00',
    url: overrides.url ?? 'https://example.test/drive',
    image_url: overrides.image_url ?? 'https://example.test/image.png',
    available: overrides.available ?? true,
    current_price_total: overrides.current_price_total ?? '100.00',
    current_price_per_tb: overrides.current_price_per_tb ?? '10.00',
    last_seen_at: overrides.last_seen_at ?? '2026-05-01T00:00:00.000Z',
    first_seen_at: overrides.first_seen_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-05-01T00:00:00.000Z',
    source: overrides.source ?? 'east-digital',
  };
}

function createHistory(entries: [string, string, string][]): PriceHistoryEntry[] {
  return entries.map(([recordedAt, total, perTb]) => ({
    recorded_at: recordedAt,
    price_total: total,
    price_per_tb: perTb,
  }));
}

function createSettings(overrides: Partial<EnabledSummarySettings> = {}): EnabledSummarySettings {
  return {
    guildId: 'guild-1',
    summaryEnabled: true,
    frequency: 'daily',
    channelId: 'summary-channel',
    time: '09:00',
    timezone: 'Etc/UTC',
    layout: 'compact',
    ...overrides,
  };
}

describe('SummaryService', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('calculates daily, weekly, and monthly summary windows', () => {
    const now = new Date('2026-05-15T09:00:00.000Z');

    const daily = getSummaryPeriod('daily', 'Etc/UTC', now);
    const weekly = getSummaryPeriod('weekly', 'Etc/UTC', now);
    const monthly = getSummaryPeriod('monthly', 'Etc/UTC', now);

    expect(daily.start.toISOString()).toBe('2026-05-14T09:00:00.000Z');
    expect(weekly.start.toISOString()).toBe('2026-05-08T09:00:00.000Z');
    expect(monthly.start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(monthly.end.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('shows best value now and better-value moves only from the current summary window', async () => {
    const products = [
      createProduct({ id: 'drop', sku: 'DROP-SKU', name: 'Drop Drive 10TB', current_price_total: '90.00', current_price_per_tb: '9.00' }),
      createProduct({ id: 'spike', sku: 'SPIKE-SKU', name: 'Spike Drive 10TB', current_price_total: '120.00', current_price_per_tb: '12.00' }),
      createProduct({ id: 'old', sku: 'OLD-SKU', name: 'Old Drive 10TB', current_price_total: '80.00', current_price_per_tb: '8.00' }),
    ];
    const histories = new Map<string, PriceHistoryEntry[]>([
      ['DROP-SKU', createHistory([
        ['2026-04-30T00:00:00.000Z', '100.00', '10.00'],
        ['2026-05-01T00:00:00.000Z', '90.00', '9.00'],
      ])],
      ['SPIKE-SKU', createHistory([
        ['2026-04-30T00:00:00.000Z', '100.00', '10.00'],
        ['2026-05-01T00:00:00.000Z', '120.00', '12.00'],
      ])],
      ['OLD-SKU', createHistory([
        ['2026-04-29T00:00:00.000Z', '100.00', '10.00'],
        ['2026-04-30T00:00:00.000Z', '80.00', '8.00'],
        ['2026-05-01T00:00:00.000Z', '80.00', '8.00'],
      ])],
    ]);
    const api = {
      fetchProducts: vi.fn(async () => products),
      fetchPriceHistory: vi.fn(async (_source: string, sku: string) => histories.get(sku) ?? []),
    };
    const currency = {
      getUsdToAudRate: vi.fn(async () => rate),
      convertUsdToAud: vi.fn((amount: number, exchangeRate: ExchangeRate | null) =>
        exchangeRate ? amount * exchangeRate.rate : null
      ),
    };
    const service = new SummaryService(db, api as never, currency as never);

    const { embed } = await service.buildSummary(
      createSettings(),
      new Date('2026-05-01T00:00:00.000Z')
    );
    const fields = embed.toJSON().fields ?? [];
    const bestValue = fields.find(field => field.name === '🏆 Best Value Now')?.value ?? '';
    const betterValue = fields.find(field => field.name === '📉 Better Value Than Yesterday')?.value ?? '';
    const compactBetterValue = fields.find(field => field.name === '📉 Better Than Yesterday')?.value ?? '';

    expect(embed.toJSON().title).toContain('💾');
    expect(embed.toJSON().description).toContain('📦');
    expect(bestValue).toContain('🏷️');
    expect(compactBetterValue).toContain('📉');
    expect(compactBetterValue).toContain('Drop Drive 10TB');
    expect(compactBetterValue).not.toContain('Spike Drive 10TB');
    expect(compactBetterValue).not.toContain('Old Drive 10TB');
    expect(betterValue).toBe('');
  });

  it('formats compact trend rows without duplicated SKU noise', async () => {
    const sku = 'U-ST18000NM000J-1-3M';
    const products = [
      createProduct({
        id: 'drop',
        sku,
        name: `${sku} Refurbished Seagate EXOS X18 18TB ${sku} SATA CMR 18.00TB Recertified neology`,
        source: 'neology',
        current_price_total: '90.00',
        current_price_per_tb: '5.00',
        capacity_tb: '18.00',
      }),
    ];
    const histories = new Map<string, PriceHistoryEntry[]>([
      [sku, createHistory([
        ['2026-04-30T00:00:00.000Z', '100.00', '5.56'],
        ['2026-05-01T00:00:00.000Z', '90.00', '5.00'],
      ])],
    ]);
    const api = {
      fetchProducts: vi.fn(async () => products),
      fetchPriceHistory: vi.fn(async (_source: string, productSku: string) => histories.get(productSku) ?? []),
    };
    const currency = {
      getUsdToAudRate: vi.fn(async () => rate),
      convertUsdToAud: vi.fn((amount: number, exchangeRate: ExchangeRate | null) =>
        exchangeRate ? amount * exchangeRate.rate : null
      ),
    };
    const service = new SummaryService(db, api as never, currency as never);

    const { embed } = await service.buildSummary(
      createSettings(),
      new Date('2026-05-01T00:00:00.000Z')
    );
    const betterValue = (embed.toJSON().fields ?? [])
      .find(field => field.name === '📉 Better Than Yesterday')?.value ?? '';

    expect(betterValue).toContain('**1. [Refurbished Seagate EXOS X18 18TB');
    expect(betterValue).toContain('](https://example.test/drive)');
    expect(betterValue).not.toContain(sku);
    expect(betterValue).toContain('📉 now A$5.00/TB');
    expect(betterValue).toContain('save A$0.56/TB');
    expect(betterValue).toContain('↘️');
    expect(betterValue.length).toBeLessThanOrEqual(1024);
  });

  it('keeps all summary field values under Discord limits', async () => {
    const products = Array.from({ length: 8 }, (_, index) => createProduct({
      id: `drop-${index}`,
      sku: `DROP-SKU-${index}`,
      name: `Very Long Product Name ${index} With Repeated Technical Detail And Extra Capacity Text 18TB SATA CMR Enterprise Recertified`,
      source: 'east-digital',
      current_price_total: `${90 + index}.00`,
      current_price_per_tb: `${5 + index}.00`,
    }));
    const history = createHistory([
      ['2026-04-30T00:00:00.000Z', '120.00', '12.00'],
      ['2026-05-01T00:00:00.000Z', '90.00', '9.00'],
    ]);
    const api = {
      fetchProducts: vi.fn(async () => products),
      fetchPriceHistory: vi.fn(async () => history),
    };
    const currency = {
      getUsdToAudRate: vi.fn(async () => rate),
      convertUsdToAud: vi.fn((amount: number, exchangeRate: ExchangeRate | null) =>
        exchangeRate ? amount * exchangeRate.rate : null
      ),
    };
    const service = new SummaryService(db, api as never, currency as never);

    const { embed } = await service.buildSummary(
      createSettings(),
      new Date('2026-05-01T00:00:00.000Z')
    );

    for (const field of embed.toJSON().fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
  });

  it('falls back to top five normalized AUD per TB products when no notable changes exist', async () => {
    const products = [
      createProduct({
        id: 'east-digital',
        sku: 'ED-SKU',
        name: 'East Digital Drive 10TB',
        source: 'east-digital',
        current_price_total: '100.00',
        current_price_per_tb: '10.00',
      }),
      createProduct({
        id: 'local',
        sku: 'AUS-SKU',
        name: 'Australian Store Drive 10TB',
        source: 'local-store',
        current_price_total: '120.00',
        current_price_per_tb: '12.00',
      }),
    ];
    const history = createHistory([
      ['2026-04-30T00:00:00.000Z', '100.00', '10.00'],
      ['2026-05-01T00:00:00.000Z', '100.00', '10.00'],
    ]);
    const api = {
      fetchProducts: vi.fn(async () => products),
      fetchPriceHistory: vi.fn(async () => history),
    };
    const currency = {
      getUsdToAudRate: vi.fn(async () => rate),
      convertUsdToAud: vi.fn((amount: number, exchangeRate: ExchangeRate | null) =>
        exchangeRate ? amount * exchangeRate.rate : null
      ),
    };
    const service = new SummaryService(db, api as never, currency as never);

    const { embed } = await service.buildSummary(
      createSettings(),
      new Date('2026-05-01T00:00:00.000Z')
    );
    const bestValue = (embed.toJSON().fields ?? [])
      .find(field => field.name === '🏆 Best Value Now')?.value ?? '';

    expect(bestValue).toContain('Australian Store Drive 10TB');
    expect(bestValue).toContain('East Digital Drive 10TB');
    expect(bestValue.indexOf('Australian Store Drive 10TB')).toBeLessThan(bestValue.indexOf('East Digital Drive 10TB'));
    expect(bestValue).toContain('~A$15.00/TB');
    expect(bestValue).not.toContain('US$10.00');
  });

  it('uses the detailed layout when configured', async () => {
    const products = [
      createProduct({ id: 'one', sku: 'ONE-SKU', current_price_total: '90.00', current_price_per_tb: '9.00' }),
      createProduct({ id: 'two', sku: 'TWO-SKU', current_price_total: '120.00', current_price_per_tb: '12.00' }),
    ];
    const histories = new Map<string, PriceHistoryEntry[]>([
      ['ONE-SKU', createHistory([
        ['2026-04-30T00:00:00.000Z', '100.00', '10.00'],
        ['2026-05-01T00:00:00.000Z', '90.00', '9.00'],
      ])],
      ['TWO-SKU', createHistory([
        ['2026-04-30T00:00:00.000Z', '120.00', '12.00'],
        ['2026-05-01T00:00:00.000Z', '120.00', '12.00'],
      ])],
    ]);
    const api = {
      fetchProducts: vi.fn(async () => products),
      fetchPriceHistory: vi.fn(async (_source: string, sku: string) => histories.get(sku) ?? []),
    };
    const currency = {
      getUsdToAudRate: vi.fn(async () => rate),
      convertUsdToAud: vi.fn((amount: number, exchangeRate: ExchangeRate | null) =>
        exchangeRate ? amount * exchangeRate.rate : null
      ),
    };
    const service = new SummaryService(db, api as never, currency as never);

    const { embed } = await service.buildSummary(
      createSettings({ layout: 'detailed' }),
      new Date('2026-05-01T00:00:00.000Z')
    );
    const fields = embed.toJSON().fields ?? [];
    const bestValue = fields.find(field => field.name === '🏆 Best $/TB Right Now (Top 5)')?.value ?? '';
    const betterValue = fields.find(field => field.name === '📉 Better Value Than Yesterday')?.value ?? '';

    expect(embed.toJSON().description).toContain('Detailed');
    expect(bestValue).toContain('ONE-SKU');
    expect(bestValue).toContain('TWO-SKU');
    expect(bestValue).toContain('US$9.00');
    expect(betterValue).toContain('save A$1.50/TB');
  });

  it('renders the image layout as a PNG attachment with listing links', async () => {
    const products = [
      createProduct({
        id: 'one',
        sku: 'ONE-SKU',
        name: 'Image Summary Drive 18TB',
        url: 'https://example.test/image-summary-drive',
        current_price_total: '90.00',
        current_price_per_tb: '5.00',
      }),
    ];
    const histories = new Map<string, PriceHistoryEntry[]>([
      ['ONE-SKU', createHistory([
        ['2026-04-30T00:00:00.000Z', '100.00', '6.00'],
        ['2026-05-01T00:00:00.000Z', '90.00', '5.00'],
      ])],
    ]);
    const api = {
      fetchProducts: vi.fn(async () => products),
      fetchPriceHistory: vi.fn(async (_source: string, sku: string) => histories.get(sku) ?? []),
    };
    const currency = {
      getUsdToAudRate: vi.fn(async () => rate),
      convertUsdToAud: vi.fn((amount: number, exchangeRate: ExchangeRate | null) =>
        exchangeRate ? amount * exchangeRate.rate : null
      ),
    };
    const service = new SummaryService(db, api as never, currency as never);

    const { embed, files } = await service.buildSummary(
      createSettings({ layout: 'image' }),
      new Date('2026-05-01T00:00:00.000Z')
    );
    const attachment = files?.[0] as { attachment: Buffer } | undefined;
    const links = (embed.toJSON().fields ?? [])
      .find(field => field.name === '🔗 Store Links')?.value ?? '';

    expect(embed.toJSON().image?.url).toBe('attachment://onlydrives-summary.png');
    expect(files).toHaveLength(1);
    expect(attachment?.attachment.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(links).toContain('[Image Summary Drive 18TB](https://example.test/image-summary-drive)');
  });
});
