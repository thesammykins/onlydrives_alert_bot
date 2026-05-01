import type { ExchangeRate } from '../types.js';
import { Database } from './database.js';

const DEFAULT_BASE_URL = 'https://api.frankfurter.dev';
const RATE_TTL_MS = 12 * 60 * 60 * 1000;

interface FrankfurterRateResponse {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

export class CurrencyService {
  private db: Database;
  private baseUrl: string;

  constructor(db: Database, baseUrl = DEFAULT_BASE_URL) {
    this.db = db;
    this.baseUrl = baseUrl;
  }

  async getUsdToAudRate(): Promise<ExchangeRate | null> {
    const cached = this.db.getExchangeRate('USD', 'AUD');
    if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < RATE_TTL_MS) {
      return cached;
    }

    try {
      const response = await fetch(`${this.baseUrl}/v2/rate/USD/AUD`);
      if (!response.ok) {
        throw new Error(`Frankfurter returned ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as FrankfurterRateResponse;
      if (data.base !== 'USD' || data.quote !== 'AUD' || typeof data.rate !== 'number') {
        throw new Error('Frankfurter response did not contain a USD/AUD rate');
      }

      const rate: Omit<ExchangeRate, 'stale'> = {
        baseCurrency: data.base,
        targetCurrency: data.quote,
        rate: data.rate,
        rateDate: data.date,
        fetchedAt: new Date().toISOString(),
      };

      this.db.upsertExchangeRate(rate);
      return { ...rate, stale: false };
    } catch (error) {
      if (cached) {
        console.warn('[Currency] Failed to refresh USD/AUD rate; using cached rate:', error);
        return { ...cached, stale: true };
      }

      console.warn('[Currency] Failed to fetch USD/AUD rate and no cached rate exists:', error);
      return null;
    }
  }

  convertUsdToAud(amount: number, rate: ExchangeRate | null): number | null {
    if (!rate) {
      return null;
    }

    return amount * rate.rate;
  }
}
