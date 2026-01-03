import { describe, it, expect } from 'vitest';
import { PriceMonitor } from '../../src/services/price-monitor.js';
import type { Product, ProductState } from '../../src/types.js';

const createProduct = (overrides: Partial<Product> = {}): Product => ({
  id: '123',
  sku: 'TEST-SKU',
  name: 'Test Drive 10TB',
  type: 'HDD',
  condition: 'New',
  capacity_tb: '10.00',
  url: 'https://example.com/product',
  image_url: 'https://example.com/image.jpg',
  available: true,
  current_price_total: '200.00',
  current_price_per_tb: '20.00',
  last_seen_at: '2026-01-01T00:00:00.000Z',
  first_seen_at: '2025-12-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  source: 'test-source',
  ...overrides,
});

const createState = (overrides: Partial<ProductState> = {}): ProductState => ({
  product_id: '123',
  sku: 'TEST-SKU',
  source: 'test-source',
  last_price_total: 200,
  last_price_per_tb: 20,
  last_available: true,
  last_checked_at: '2025-12-31T00:00:00.000Z',
  first_seen_at: '2025-12-01T00:00:00.000Z',
  ...overrides,
});

describe('PriceMonitor', () => {
  const monitor = new PriceMonitor({
    priceDropThreshold: 0.05,
    priceSpikeThreshold: 0.10,
  });

  describe('detectChanges', () => {
    it('detects new product when no previous state exists', () => {
      const product = createProduct();
      const alerts = monitor.detectChanges(product, null);

      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.type).toBe('new_product');
      expect(alerts[0]?.currentPrice).toBe(200);
    });

    it('detects price drop when threshold exceeded', () => {
      const product = createProduct({ current_price_total: '180.00' });
      const state = createState({ last_price_total: 200 });
      const alerts = monitor.detectChanges(product, state);

      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.type).toBe('price_drop');
      expect(alerts[0]?.previousPrice).toBe(200);
      expect(alerts[0]?.currentPrice).toBe(180);
      expect(alerts[0]?.percentChange).toBeCloseTo(-0.10);
    });

    it('detects price spike when threshold exceeded', () => {
      const product = createProduct({ current_price_total: '230.00' });
      const state = createState({ last_price_total: 200 });
      const alerts = monitor.detectChanges(product, state);

      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.type).toBe('price_spike');
      expect(alerts[0]?.percentChange).toBeCloseTo(0.15);
    });

    it('ignores small price changes below threshold', () => {
      const product = createProduct({ current_price_total: '198.00' });
      const state = createState({ last_price_total: 200 });
      const alerts = monitor.detectChanges(product, state);

      expect(alerts).toHaveLength(0);
    });

    it('cumulative small changes eventually trigger alert when baseline preserved', () => {
      const state = createState({ last_price_total: 200 });
      
      const product1 = createProduct({ current_price_total: '196.00' });
      expect(monitor.detectChanges(product1, state)).toHaveLength(0);
      
      const product2 = createProduct({ current_price_total: '192.00' });
      expect(monitor.detectChanges(product2, state)).toHaveLength(0);
      
      const product3 = createProduct({ current_price_total: '188.00' });
      const alerts = monitor.detectChanges(product3, state);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.type).toBe('price_drop');
      expect(alerts[0]?.percentChange).toBeCloseTo(-0.06);
    });

    it('detects back in stock', () => {
      const product = createProduct({ available: true });
      const state = createState({ last_available: false });
      const alerts = monitor.detectChanges(product, state);

      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.type).toBe('back_in_stock');
    });

    it('ignores going out of stock', () => {
      const product = createProduct({ available: false });
      const state = createState({ last_available: true });
      const alerts = monitor.detectChanges(product, state);

      expect(alerts).toHaveLength(0);
    });

    it('can detect multiple alerts at once', () => {
      const product = createProduct({ 
        current_price_total: '170.00',
        available: true 
      });
      const state = createState({ 
        last_price_total: 200,
        last_available: false 
      });
      const alerts = monitor.detectChanges(product, state);

      expect(alerts).toHaveLength(2);
      const types = alerts.map(a => a.type);
      expect(types).toContain('price_drop');
      expect(types).toContain('back_in_stock');
    });
  });

  describe('parsePrice', () => {
    it('parses string price to number', () => {
      expect(PriceMonitor.parsePrice('123.45')).toBe(123.45);
      expect(PriceMonitor.parsePrice('1000.00')).toBe(1000);
    });

    it('handles undefined/null gracefully', () => {
      expect(PriceMonitor.parsePrice(undefined as unknown as string)).toBe(0);
      expect(PriceMonitor.parsePrice('')).toBe(0);
    });
  });
});
