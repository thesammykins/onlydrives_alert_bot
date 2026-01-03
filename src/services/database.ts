import BetterSqlite3 from 'better-sqlite3';
import type { ProductState, AlertType, BotSettings, SkuSubscription } from '../types.js';

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS product_state (
        product_id TEXT PRIMARY KEY,
        sku TEXT NOT NULL,
        source TEXT NOT NULL,
        last_price_total REAL NOT NULL,
        last_price_per_tb REAL NOT NULL,
        last_available INTEGER NOT NULL,
        last_checked_at TEXT NOT NULL,
        first_seen_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_state_sku ON product_state(sku);

      CREATE TABLE IF NOT EXISTS alert_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        sent_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_alerts_product_type ON alert_log(product_id, alert_type, sent_at);

      CREATE TABLE IF NOT EXISTS bot_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sku_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        delivery_method TEXT NOT NULL DEFAULT 'dm',
        channel_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, sku)
      );

      CREATE INDEX IF NOT EXISTS idx_subscriptions_sku ON sku_subscriptions(sku);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON sku_subscriptions(user_id);
    `);
  }

  getConfig(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM bot_config WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setConfig(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO bot_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    stmt.run(key, value, new Date().toISOString());
  }

  deleteConfig(key: string): void {
    const stmt = this.db.prepare('DELETE FROM bot_config WHERE key = ?');
    stmt.run(key);
  }

  getAllConfig(): Record<string, string> {
    const stmt = this.db.prepare('SELECT key, value FROM bot_config');
    const rows = stmt.all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  isInitialSyncComplete(): boolean {
    return this.getConfig('initial_sync_complete') === 'true';
  }

  markInitialSyncComplete(): void {
    this.setConfig('initial_sync_complete', 'true');
  }

  getBotSettings(): BotSettings {
    const config = this.getAllConfig();
    return {
      channelPriceDrop: config['channel_price_drop'] ?? null,
      channelPriceSpike: config['channel_price_spike'] ?? null,
      channelNewProduct: config['channel_new_product'] ?? null,
      channelBackInStock: config['channel_back_in_stock'] ?? null,
      alertPriceDropEnabled: config['alert_price_drop_enabled'] !== 'false',
      alertPriceSpikeEnabled: config['alert_price_spike_enabled'] !== 'false',
      alertNewProductEnabled: config['alert_new_product_enabled'] !== 'false',
      alertBackInStockEnabled: config['alert_back_in_stock_enabled'] !== 'false',
      priceDropThreshold: config['price_drop_threshold'] ? parseFloat(config['price_drop_threshold']) : null,
      priceSpikeThreshold: config['price_spike_threshold'] ? parseFloat(config['price_spike_threshold']) : null,
      pollIntervalMs: config['poll_interval_ms'] ? parseInt(config['poll_interval_ms'], 10) : null,
      alertCooldownMs: config['alert_cooldown_ms'] ? parseInt(config['alert_cooldown_ms'], 10) : null,
    };
  }

  setBotSetting(key: string, value: string | null): void {
    if (value === null) {
      this.deleteConfig(key);
    } else {
      this.setConfig(key, value);
    }
  }

  getProductState(productId: string): ProductState | null {
    const stmt = this.db.prepare(`
      SELECT product_id, sku, source, last_price_total, last_price_per_tb, 
             last_available, last_checked_at, first_seen_at
      FROM product_state WHERE product_id = ?
    `);
    
    const row = stmt.get(productId) as ProductStateRow | undefined;
    if (!row) return null;

    return {
      product_id: row.product_id,
      sku: row.sku,
      source: row.source,
      last_price_total: row.last_price_total,
      last_price_per_tb: row.last_price_per_tb,
      last_available: Boolean(row.last_available),
      last_checked_at: row.last_checked_at,
      first_seen_at: row.first_seen_at,
    };
  }

  getAllProductStates(): ProductState[] {
    const stmt = this.db.prepare(`
      SELECT product_id, sku, source, last_price_total, last_price_per_tb,
             last_available, last_checked_at, first_seen_at
      FROM product_state
    `);

    const rows = stmt.all() as ProductStateRow[];
    return rows.map(row => ({
      product_id: row.product_id,
      sku: row.sku,
      source: row.source,
      last_price_total: row.last_price_total,
      last_price_per_tb: row.last_price_per_tb,
      last_available: Boolean(row.last_available),
      last_checked_at: row.last_checked_at,
      first_seen_at: row.first_seen_at,
    }));
  }

  upsertProductState(state: ProductState): void {
    const stmt = this.db.prepare(`
      INSERT INTO product_state (product_id, sku, source, last_price_total, last_price_per_tb,
                                  last_available, last_checked_at, first_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_id) DO UPDATE SET
        last_price_total = excluded.last_price_total,
        last_price_per_tb = excluded.last_price_per_tb,
        last_available = excluded.last_available,
        last_checked_at = excluded.last_checked_at
    `);

    stmt.run(
      state.product_id,
      state.sku,
      state.source,
      state.last_price_total,
      state.last_price_per_tb,
      state.last_available ? 1 : 0,
      state.last_checked_at,
      state.first_seen_at
    );
  }

  logAlert(productId: string, alertType: AlertType): void {
    const stmt = this.db.prepare(`
      INSERT INTO alert_log (product_id, alert_type, sent_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(productId, alertType, new Date().toISOString());
  }

  canSendAlert(productId: string, alertType: AlertType, cooldownMs: number): boolean {
    const stmt = this.db.prepare(`
      SELECT sent_at FROM alert_log 
      WHERE product_id = ? AND alert_type = ?
      ORDER BY sent_at DESC LIMIT 1
    `);

    const row = stmt.get(productId, alertType) as { sent_at: string } | undefined;
    if (!row) return true;

    const lastSent = new Date(row.sent_at).getTime();
    const now = Date.now();
    return (now - lastSent) >= cooldownMs;
  }

  addSkuSubscription(userId: string, sku: string, deliveryMethod: 'dm' | 'channel', channelId: string | null): boolean {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO sku_subscriptions (user_id, sku, delivery_method, channel_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(userId, sku.toUpperCase(), deliveryMethod, channelId, new Date().toISOString());
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        return false;
      }
      throw error;
    }
  }

  removeSkuSubscription(userId: string, sku: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM sku_subscriptions WHERE user_id = ? AND sku = ?
    `);
    const result = stmt.run(userId, sku.toUpperCase());
    return result.changes > 0;
  }

  getUserSubscriptions(userId: string): SkuSubscription[] {
    const stmt = this.db.prepare(`
      SELECT id, user_id, sku, delivery_method, channel_id, created_at FROM sku_subscriptions WHERE user_id = ?
    `);
    return stmt.all(userId) as SkuSubscription[];
  }

  getSubscribersForSku(sku: string): SkuSubscription[] {
    const stmt = this.db.prepare(`
      SELECT id, user_id, sku, delivery_method, channel_id, created_at FROM sku_subscriptions WHERE sku = ?
    `);
    return stmt.all(sku.toUpperCase()) as SkuSubscription[];
  }

  getAllSubscribedSkus(): string[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT sku FROM sku_subscriptions
    `);
    const rows = stmt.all() as { sku: string }[];
    return rows.map(r => r.sku);
  }

  close(): void {
    this.db.close();
  }
}

interface ProductStateRow {
  product_id: string;
  sku: string;
  source: string;
  last_price_total: number;
  last_price_per_tb: number;
  last_available: number;
  last_checked_at: string;
  first_seen_at: string;
}
