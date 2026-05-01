import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrencyService } from '../../src/services/currency.js';
import { Database } from '../../src/services/database.js';

describe('CurrencyService', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    db.close();
  });

  it('fetches and caches the USD to AUD rate from Frankfurter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        date: '2026-04-30',
        base: 'USD',
        quote: 'AUD',
        rate: 1.54,
      }),
    })));

    const service = new CurrencyService(db, 'https://example.test');
    const rate = await service.getUsdToAudRate();
    const cached = db.getExchangeRate('USD', 'AUD');

    expect(fetch).toHaveBeenCalledWith('https://example.test/v2/rate/USD/AUD');
    expect(rate?.rate).toBe(1.54);
    expect(rate?.rateDate).toBe('2026-04-30');
    expect(rate?.stale).toBe(false);
    expect(cached?.rate).toBe(1.54);
    expect(service.convertUsdToAud(100, rate)).toBe(154);
  });

  it('uses a stale cached rate when refresh fails', async () => {
    db.upsertExchangeRate({
      baseCurrency: 'USD',
      targetCurrency: 'AUD',
      rate: 1.5,
      rateDate: '2026-04-29',
      fetchedAt: '2026-04-29T00:00:00.000Z',
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    const service = new CurrencyService(db, 'https://example.test');
    const rate = await service.getUsdToAudRate();

    expect(rate?.rate).toBe(1.5);
    expect(rate?.stale).toBe(true);
  });

  it('returns null when refresh fails and no cached rate exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    const service = new CurrencyService(db, 'https://example.test');
    const rate = await service.getUsdToAudRate();

    expect(rate).toBeNull();
    expect(service.convertUsdToAud(100, rate)).toBeNull();
  });
});
