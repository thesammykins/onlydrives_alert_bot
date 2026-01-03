import type { Product, PriceHistoryEntry } from '../types.js';

const BASE_URL = 'https://onlydrives.tx.au/api';

export class OnlyDrivesApi {
  private baseUrl: string;

  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async fetchProducts(): Promise<Product[]> {
    const response = await fetch(`${this.baseUrl}/products`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<Product[]>;
  }

  async fetchPriceHistory(source: string, sku: string): Promise<PriceHistoryEntry[]> {
    const key = OnlyDrivesApi.getProductKey(source, sku);
    const response = await fetch(`${this.baseUrl}/sku/${key}/price-history`);

    if (!response.ok) {
      if (response.status === 404 || response.status === 400) {
        return [];
      }
      throw new Error(`Failed to fetch price history: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<PriceHistoryEntry[]>;
  }

  static getProductKey(source: string, sku: string): string {
    return `${source}-${sku}`;
  }
}
