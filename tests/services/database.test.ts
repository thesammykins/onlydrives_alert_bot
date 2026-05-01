import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { Database } from '../../src/services/database.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Product, ProductState } from '../../src/types.js';

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
    it('migrates an existing alert_log table that has no guild_id column', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'onlydrives-db-'));
      const dbPath = path.join(dir, 'bot.db');
      const oldDb = new BetterSqlite3(dbPath);
      oldDb.exec(`
        CREATE TABLE alert_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id TEXT NOT NULL,
          alert_type TEXT NOT NULL,
          sent_at TEXT NOT NULL
        );
      `);
      oldDb.close();

      const migrated = new Database(dbPath);
      migrated.logAlert('guild-1', 'product-1', 'price_drop');

      expect(migrated.canSendAlert('guild-1', 'product-1', 'price_drop', 60000)).toBe(false);

      migrated.close();
      await rm(dir, { recursive: true, force: true });
    });

    it('logs alert and respects cooldown', () => {
      const guildId = 'guild-1';
      const productId = 'alert-test';
      const alertType = 'price_drop';

      const canSendBefore = db.canSendAlert(guildId, productId, alertType, 60000);
      expect(canSendBefore).toBe(true);

      db.logAlert(guildId, productId, alertType);

      const canSendAfter = db.canSendAlert(guildId, productId, alertType, 60000);
      expect(canSendAfter).toBe(false);
    });

    it('allows alert after cooldown expires', () => {
      const guildId = 'guild-1';
      const productId = 'cooldown-test';
      const alertType = 'price_spike';

      db.logAlert(guildId, productId, alertType);
      
      const canSendWithShortCooldown = db.canSendAlert(guildId, productId, alertType, 0);
      expect(canSendWithShortCooldown).toBe(true);
    });

    it('different alert types have separate cooldowns', () => {
      const guildId = 'guild-1';
      const productId = 'multi-alert';

      db.logAlert(guildId, productId, 'price_drop');

      expect(db.canSendAlert(guildId, productId, 'price_drop', 60000)).toBe(false);
      expect(db.canSendAlert(guildId, productId, 'back_in_stock', 60000)).toBe(true);
    });

    it('guilds have separate alert cooldowns', () => {
      const productId = 'guild-alert';

      db.logAlert('guild-1', productId, 'price_drop');

      expect(db.canSendAlert('guild-1', productId, 'price_drop', 60000)).toBe(false);
      expect(db.canSendAlert('guild-2', productId, 'price_drop', 60000)).toBe(true);
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

  describe('user preferences', () => {
    it('upserts and retrieves preferences', () => {
      expect(db.getUserPreferences('user-1')).toBeNull();

      db.upsertUserPreferences('user-1', 22, 6);
      const prefs = db.getUserPreferences('user-1');

      expect(prefs?.quiet_start_hour).toBe(22);
      expect(prefs?.quiet_end_hour).toBe(6);
    });

    it('clears preferences when set to null', () => {
      db.upsertUserPreferences('user-1', 8, 17);
      db.upsertUserPreferences('user-1', null, null);

      const prefs = db.getUserPreferences('user-1');
      expect(prefs?.quiet_start_hour).toBeNull();
      expect(prefs?.quiet_end_hour).toBeNull();
    });
  });

  describe('getBotSettings', () => {
    it('returns disabled defaults when no guild config is set', () => {
      const settings = db.getBotSettings('guild-1');

      expect(settings.channelPriceDrop).toBeNull();
      expect(settings.alertPriceDropEnabled).toBe(false);
      expect(settings.priceDropThreshold).toBeNull();
      expect(settings.pollIntervalMs).toBeNull();
      expect(settings.summaryEnabled).toBe(false);
      expect(settings.summaryLayout).toBe('compact');
    });

    it('returns configured values', () => {
      db.setGuildConfig('guild-1', 'channel_price_drop', '123456');
      db.setGuildConfig('guild-1', 'alert_price_drop_enabled', 'true');
      db.setGuildConfig('guild-1', 'price_drop_threshold', '0.08');
      db.setGuildConfig('guild-1', 'poll_interval_ms', '60000');
      db.setGuildConfig('guild-1', 'summary_enabled', 'true');
      db.setGuildConfig('guild-1', 'summary_frequency', 'weekly');
      db.setGuildConfig('guild-1', 'summary_channel_id', 'summary-channel');
      db.setGuildConfig('guild-1', 'summary_time', '09:00');
      db.setGuildConfig('guild-1', 'summary_timezone', 'Australia/Melbourne');
      db.setGuildConfig('guild-1', 'summary_layout', 'detailed');

      const settings = db.getBotSettings('guild-1');

      expect(settings.channelPriceDrop).toBe('123456');
      expect(settings.alertPriceDropEnabled).toBe(true);
      expect(settings.priceDropThreshold).toBe(0.08);
      expect(settings.pollIntervalMs).toBe(60000);
      expect(settings.summaryEnabled).toBe(true);
      expect(settings.summaryFrequency).toBe('weekly');
      expect(settings.summaryChannelId).toBe('summary-channel');
      expect(settings.summaryLayout).toBe('detailed');
    });
  });

  describe('setBotSetting', () => {
    it('sets values', () => {
      db.setBotSetting('guild-1', 'channel_new_product', '999');
      expect(db.getGuildConfig('guild-1', 'channel_new_product')).toBe('999');
    });

    it('deletes values when null', () => {
      db.setGuildConfig('guild-1', 'channel_new_product', '999');
      db.setBotSetting('guild-1', 'channel_new_product', null);
      expect(db.getGuildConfig('guild-1', 'channel_new_product')).toBeNull();
    });
  });

  describe('guild-scoped configuration', () => {
    it('does not share settings between guilds', () => {
      db.setBotSetting('guild-a', 'alert_price_drop_enabled', 'true');
      db.setBotSetting('guild-a', 'channel_price_drop', 'channel-a');

      const guildA = db.getBotSettings('guild-a');
      const guildB = db.getBotSettings('guild-b');

      expect(guildA.alertPriceDropEnabled).toBe(true);
      expect(guildA.channelPriceDrop).toBe('channel-a');
      expect(guildB.alertPriceDropEnabled).toBe(false);
      expect(guildB.channelPriceDrop).toBeNull();
    });

    it('migrates legacy global config only to the resolved legacy guild', () => {
      db.setConfig('alert_price_drop_enabled', 'false');
      db.setConfig('price_drop_threshold', '0.08');

      db.migrateLegacyGlobalConfig('legacy-guild', 'default-channel');

      const legacy = db.getBotSettings('legacy-guild');
      const other = db.getBotSettings('new-guild');

      expect(legacy.alertPriceDropEnabled).toBe(false);
      expect(legacy.priceDropThreshold).toBe(0.08);
      expect(legacy.alertPriceSpikeEnabled).toBe(true);
      expect(legacy.channelPriceSpike).toBe('default-channel');
      expect(other.alertPriceSpikeEnabled).toBe(false);
      expect(other.channelPriceSpike).toBeNull();
    });
  });

  describe('summary settings and runs', () => {
    it('stores enabled summary settings for a guild', () => {
      db.setSummarySettings('guild-1', {
        enabled: true,
        frequency: 'daily',
        channelId: 'summary-channel',
        time: '09:00',
        timezone: 'Australia/Melbourne',
        layout: 'detailed',
      });

      const settings = db.getSummarySettings('guild-1');
      const enabled = db.getEnabledSummarySettings();

      expect(settings.summaryEnabled).toBe(true);
      expect(settings.frequency).toBe('daily');
      expect(settings.channelId).toBe('summary-channel');
      expect(settings.layout).toBe('detailed');
      expect(enabled).toHaveLength(1);
      expect(enabled[0]!.guildId).toBe('guild-1');
      expect(enabled[0]!.layout).toBe('detailed');
    });

    it('disables summaries without removing the stored cadence', () => {
      db.setSummarySettings('guild-1', {
        enabled: true,
        frequency: 'weekly',
        channelId: 'summary-channel',
        time: '09:00',
        timezone: 'Australia/Melbourne',
      });

      db.disableSummary('guild-1');

      const settings = db.getSummarySettings('guild-1');
      expect(settings.summaryEnabled).toBe(false);
      expect(settings.frequency).toBe('weekly');
      expect(db.getEnabledSummarySettings()).toEqual([]);
    });

    it('deduplicates summary runs by guild, frequency, and period', () => {
      const run = {
        guildId: 'guild-1',
        frequency: 'daily' as const,
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2026-01-02T00:00:00.000Z',
        channelId: 'summary-channel',
        messageId: 'message-1',
        sentAt: '2026-01-02T09:00:00.000Z',
      };

      expect(db.recordSummaryRun(run)).toBe(true);
      expect(db.recordSummaryRun({ ...run, messageId: 'message-2' })).toBe(false);
      expect(db.hasSummaryRun('guild-1', 'daily', run.periodStart, run.periodEnd)).toBe(true);
      expect(db.recordSummaryRun({ ...run, guildId: 'guild-2', messageId: 'message-3' })).toBe(true);
    });
  });

  describe('SKU subscriptions', () => {
    it('adds a subscription', () => {
      const success = db.addSkuSubscription('user-1', 'TEST-SKU', 'dm', null);
      expect(success).toBe(true);

      const subs = db.getUserSubscriptions('user-1');
      expect(subs).toHaveLength(1);
      expect(subs[0].sku).toBe('TEST-SKU');
      expect(subs[0].delivery_method).toBe('dm');
    });

    it('adds multiple subscriptions with thresholds', () => {
      const results = db.addSkuSubscriptions('user-1', ['SKU-A', 'SKU-B'], 'dm', null, {
        priceDropThreshold: 0.08,
        priceSpikeThreshold: 0.12,
      });

      expect(results.added.sort()).toEqual(['SKU-A', 'SKU-B']);
      expect(results.duplicates).toHaveLength(0);

      const subs = db.getUserSubscriptions('user-1');
      expect(subs).toHaveLength(2);
      expect(subs[0].price_drop_threshold).toBe(0.08);
      expect(subs[0].price_spike_threshold).toBe(0.12);
    });

    it('prevents duplicate subscriptions', () => {
      db.addSkuSubscription('user-1', 'DUP-SKU', 'dm', null);
      const duplicate = db.addSkuSubscription('user-1', 'dup-sku', 'channel', 'chan-123');
      expect(duplicate).toBe(false);
    });

    it('removes a subscription', () => {
      db.addSkuSubscription('user-1', 'REMOVE-ME', 'dm', null);
      const removed = db.removeSkuSubscription('user-1', 'remove-me');
      expect(removed).toBe(true);

      const subs = db.getUserSubscriptions('user-1');
      expect(subs).toHaveLength(0);
    });

    it('returns false when removing non-existent subscription', () => {
      const removed = db.removeSkuSubscription('user-1', 'NONEXISTENT');
      expect(removed).toBe(false);
    });

    it('gets subscribers for SKU', () => {
      db.addSkuSubscription('user-1', 'SHARED-SKU', 'dm', null);
      db.addSkuSubscription('user-2', 'shared-sku', 'channel', 'chan-456');

      const subs = db.getSubscribersForSku('SHARED-SKU');
      expect(subs).toHaveLength(2);
      expect(subs.map(s => s.user_id).sort()).toEqual(['user-1', 'user-2']);
    });

    it('gets all subscribed SKUs', () => {
      db.addSkuSubscription('user-1', 'SKU-A', 'dm', null);
      db.addSkuSubscription('user-2', 'SKU-B', 'dm', null);
      db.addSkuSubscription('user-3', 'sku-a', 'channel', 'chan-789');

      const skus = db.getAllSubscribedSkus();
      expect(skus.sort()).toEqual(['SKU-A', 'SKU-B']);
    });

    it('stores channel delivery correctly', () => {
      db.addSkuSubscription('user-1', 'CHANNEL-SKU', 'channel', 'chan-999');

      const subs = db.getUserSubscriptions('user-1');
      expect(subs[0].delivery_method).toBe('channel');
      expect(subs[0].channel_id).toBe('chan-999');
    });
  });

  describe('product cache', () => {
    function makeProduct(overrides: Partial<Product> = {}): Product {
      return {
        id: 'src-SKU-1',
        sku: 'SKU-1',
        name: 'Test Drive 1TB',
        type: 'HDD',
        condition: 'New',
        capacity_tb: '1',
        url: 'https://example.com/drive',
        image_url: 'https://example.com/img.png',
        available: true,
        current_price_total: '100.00',
        current_price_per_tb: '100.00',
        last_seen_at: '2026-01-01T00:00:00.000Z',
        first_seen_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        source: 'src',
        ...overrides,
      };
    }

    it('getCachedProducts returns empty array when cache is empty', () => {
      expect(db.getCachedProducts()).toEqual([]);
    });

    it('upsertCachedProducts stores and retrieves products', () => {
      const product = makeProduct();
      db.upsertCachedProducts([product]);
      const cached = db.getCachedProducts();
      expect(cached).toHaveLength(1);
      expect(cached[0]!.id).toBe('src-SKU-1');
      expect(cached[0]!.name).toBe('Test Drive 1TB');
    });

    it('upsertCachedProducts updates when data changes', () => {
      const product = makeProduct();
      db.upsertCachedProducts([product]);
      db.upsertCachedProducts([{ ...product, current_price_total: '90.00' }]);
      const cached = db.getCachedProducts();
      expect(cached).toHaveLength(1);
      expect(cached[0]!.current_price_total).toBe('90.00');
    });

    it('upsertCachedProducts removes products missing from the latest snapshot', () => {
      const p1 = makeProduct({ id: 'src-SKU-1', sku: 'SKU-1' });
      const p2 = makeProduct({ id: 'src-SKU-2', sku: 'SKU-2', name: 'Test Drive 2TB' });

      db.upsertCachedProducts([p1, p2]);
      db.upsertCachedProducts([p2]);

      const cached = db.getCachedProducts();
      expect(cached).toHaveLength(1);
      expect(cached[0]!.sku).toBe('SKU-2');
    });

    it('upsertCachedProducts clears the cache when the latest snapshot is empty', () => {
      const product = makeProduct();

      db.upsertCachedProducts([product]);
      db.upsertCachedProducts([]);

      expect(db.getCachedProducts()).toEqual([]);
    });

    it('handles multiple products', () => {
      const p1 = makeProduct({ id: 'src-SKU-1', sku: 'SKU-1' });
      const p2 = makeProduct({ id: 'src-SKU-2', sku: 'SKU-2', name: 'Test Drive 2TB' });
      db.upsertCachedProducts([p1, p2]);
      const cached = db.getCachedProducts();
      expect(cached).toHaveLength(2);
      expect(cached.map(p => p.sku).sort()).toEqual(['SKU-1', 'SKU-2']);
    });
  });
});
