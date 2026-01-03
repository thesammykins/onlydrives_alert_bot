import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnlyDrivesApi } from '../../src/services/api.js';

describe('OnlyDrivesApi', () => {
  let api: OnlyDrivesApi;

  beforeEach(() => {
    api = new OnlyDrivesApi();
  });

  describe('fetchProducts', () => {
    it('returns array of products from API', async () => {
      const products = await api.fetchProducts();

      expect(Array.isArray(products)).toBe(true);
      expect(products.length).toBeGreaterThan(0);
    });

    it('products have required fields', async () => {
      const products = await api.fetchProducts();
      const product = products[0];

      expect(product).toHaveProperty('id');
      expect(product).toHaveProperty('sku');
      expect(product).toHaveProperty('name');
      expect(product).toHaveProperty('type');
      expect(product).toHaveProperty('current_price_total');
      expect(product).toHaveProperty('current_price_per_tb');
      expect(product).toHaveProperty('available');
      expect(product).toHaveProperty('source');
    });

    it('type is HDD or SSD', async () => {
      const products = await api.fetchProducts();
      
      for (const product of products) {
        expect(['HDD', 'SSD']).toContain(product.type);
      }
    });
  });

  describe('fetchPriceHistory', () => {
    it('returns array of price history entries', async () => {
      const history = await api.fetchPriceHistory('east-digital', 'ST22000NM000C-R');

      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
    });

    it('entries have required fields', async () => {
      const history = await api.fetchPriceHistory('east-digital', 'ST22000NM000C-R');
      const entry = history[0];

      expect(entry).toHaveProperty('recorded_at');
      expect(entry).toHaveProperty('price_total');
      expect(entry).toHaveProperty('price_per_tb');
    });

    it('returns empty array for non-existent product', async () => {
      const history = await api.fetchPriceHistory('fake-source', 'FAKE-SKU');

      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBe(0);
    });
  });

  describe('getProductKey', () => {
    it('creates correct key from source and sku', () => {
      const key = OnlyDrivesApi.getProductKey('east-digital', 'ST22000NM000C-R');
      expect(key).toBe('east-digital-ST22000NM000C-R');
    });
  });
});
