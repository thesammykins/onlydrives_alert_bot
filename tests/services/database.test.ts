import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/services/database.js';
import { unlink } from 'fs/promises';
import type { ProductState } from '../../src/types.js';

const TEST_DB_PATH = ':memory:';

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(TEST_DB_PATH);
  });

  afterEach(() => {
    db.close();
  });

  describe('getProductState', () => {
    it('returns null for unknown product', () => {
      const state = db.getProductState('unknown-id');
      expect(state).toBeNull();
    });

    it('returns saved state', () => {
      const state: ProductState = {
        product_id: 'test-123',
        sku: 'TEST-SKU',
        source: 'test-source',
        last_price_total: 100,
        last_price_per_tb: 10,
        last_available: true,
        last_checked_at: '2026-01-01T00:00:00.000Z',
        first_seen_at: '2025-12-01T00:00:00.000Z',
      };

      db.upsertProductState(state);
      const retrieved = db.getProductState('test-123');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.product_id).toBe('test-123');
      expect(retrieved?.last_price_total).toBe(100);
    });
  });

  describe('upsertProductState', () => {
    it('inserts new state', () => {
      const state: ProductState = {
        product_id: 'new-product',
        sku: 'NEW-SKU',
        source: 'test-source',
        last_price_total: 250,
        last_price_per_tb: 25,
        last_available: true,
        last_checked_at: '2026-01-02T00:00:00.000Z',
        first_seen_at: '2026-01-01T00:00:00.000Z',
      };

      db.upsertProductState(state);
      const retrieved = db.getProductState('new-product');

      expect(retrieved?.last_price_total).toBe(250);
    });

    it('updates existing state', () => {
      const initialState: ProductState = {
        product_id: 'update-test',
        sku: 'UPDATE-SKU',
        source: 'test-source',
        last_price_total: 100,
        last_price_per_tb: 10,
        last_available: true,
        last_checked_at: '2026-01-01T00:00:00.000Z',
        first_seen_at: '2025-12-01T00:00:00.000Z',
      };

      db.upsertProductState(initialState);

      const updatedState: ProductState = {
        ...initialState,
        last_price_total: 90,
        last_checked_at: '2026-01-02T00:00:00.000Z',
      };

      db.upsertProductState(updatedState);
      const retrieved = db.getProductState('update-test');

      expect(retrieved?.last_price_total).toBe(90);
      expect(retrieved?.first_seen_at).toBe('2025-12-01T00:00:00.000Z');
    });
  });

  describe('alert logging', () => {
    it('logs alert and respects cooldown', () => {
      const productId = 'alert-test';
      const alertType = 'price_drop';

      const canSendBefore = db.canSendAlert(productId, alertType, 60000);
      expect(canSendBefore).toBe(true);

      db.logAlert(productId, alertType);

      const canSendAfter = db.canSendAlert(productId, alertType, 60000);
      expect(canSendAfter).toBe(false);
    });

    it('allows alert after cooldown expires', () => {
      const productId = 'cooldown-test';
      const alertType = 'price_spike';

      db.logAlert(productId, alertType);
      
      const canSendWithShortCooldown = db.canSendAlert(productId, alertType, 0);
      expect(canSendWithShortCooldown).toBe(true);
    });

    it('different alert types have separate cooldowns', () => {
      const productId = 'multi-alert';

      db.logAlert(productId, 'price_drop');

      expect(db.canSendAlert(productId, 'price_drop', 60000)).toBe(false);
      expect(db.canSendAlert(productId, 'back_in_stock', 60000)).toBe(true);
    });
  });

  describe('getAllProductStates', () => {
    it('returns all stored states', () => {
      db.upsertProductState({
        product_id: 'product-1',
        sku: 'SKU-1',
        source: 'source-1',
        last_price_total: 100,
        last_price_per_tb: 10,
        last_available: true,
        last_checked_at: '2026-01-01T00:00:00.000Z',
        first_seen_at: '2025-12-01T00:00:00.000Z',
      });

      db.upsertProductState({
        product_id: 'product-2',
        sku: 'SKU-2',
        source: 'source-2',
        last_price_total: 200,
        last_price_per_tb: 20,
        last_available: false,
        last_checked_at: '2026-01-01T00:00:00.000Z',
        first_seen_at: '2025-12-01T00:00:00.000Z',
      });

      const allStates = db.getAllProductStates();
      expect(allStates).toHaveLength(2);
    });
  });

  describe('bot configuration', () => {
    it('gets and sets config values', () => {
      expect(db.getConfig('test_key')).toBeNull();

      db.setConfig('test_key', 'test_value');
      expect(db.getConfig('test_key')).toBe('test_value');

      db.setConfig('test_key', 'new_value');
      expect(db.getConfig('test_key')).toBe('new_value');
    });

    it('deletes config values', () => {
      db.setConfig('delete_me', 'value');
      expect(db.getConfig('delete_me')).toBe('value');

      db.deleteConfig('delete_me');
      expect(db.getConfig('delete_me')).toBeNull();
    });

    it('gets all config as object', () => {
      db.setConfig('key1', 'value1');
      db.setConfig('key2', 'value2');

      const all = db.getAllConfig();
      expect(all['key1']).toBe('value1');
      expect(all['key2']).toBe('value2');
    });
  });

  describe('initial sync detection', () => {
    it('tracks initial sync state', () => {
      expect(db.isInitialSyncComplete()).toBe(false);

      db.markInitialSyncComplete();
      expect(db.isInitialSyncComplete()).toBe(true);
    });
  });

  describe('getBotSettings', () => {
    it('returns defaults when no config set', () => {
      const settings = db.getBotSettings();

      expect(settings.channelPriceDrop).toBeNull();
      expect(settings.alertPriceDropEnabled).toBe(true);
      expect(settings.priceDropThreshold).toBeNull();
      expect(settings.pollIntervalMs).toBeNull();
    });

    it('returns configured values', () => {
      db.setConfig('channel_price_drop', '123456');
      db.setConfig('alert_price_drop_enabled', 'false');
      db.setConfig('price_drop_threshold', '0.08');
      db.setConfig('poll_interval_ms', '60000');

      const settings = db.getBotSettings();

      expect(settings.channelPriceDrop).toBe('123456');
      expect(settings.alertPriceDropEnabled).toBe(false);
      expect(settings.priceDropThreshold).toBe(0.08);
      expect(settings.pollIntervalMs).toBe(60000);
    });
  });

  describe('setBotSetting', () => {
    it('sets values', () => {
      db.setBotSetting('channel_new_product', '999');
      expect(db.getConfig('channel_new_product')).toBe('999');
    });

    it('deletes values when null', () => {
      db.setConfig('channel_new_product', '999');
      db.setBotSetting('channel_new_product', null);
      expect(db.getConfig('channel_new_product')).toBeNull();
    });
  });
});
