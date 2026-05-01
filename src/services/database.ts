import BetterSqlite3 from 'better-sqlite3';
import type {
  AlertType,
  BotSettings,
  EnabledSummarySettings,
  ExchangeRate,
  Product,
  ProductState,
  SkuSubscription,
  SummaryFrequency,
  SummaryLayout,
  SummaryRun,
  SummarySettings,
  UserPreferences,
} from '../types.js';

const ALERT_TYPES: AlertType[] = ['price_drop', 'price_spike', 'new_product', 'back_in_stock'];
const DEFAULT_GUILD_ID = '__default__';

const SUMMARY_FREQUENCIES: SummaryFrequency[] = ['daily', 'weekly', 'monthly'];
const SUMMARY_LAYOUTS: SummaryLayout[] = ['compact', 'detailed'];

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
        guild_id TEXT,
        product_id TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        sent_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bot_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS guild_config (
        guild_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (guild_id, key)
      );

      CREATE INDEX IF NOT EXISTS idx_guild_config_key ON guild_config(key, value);

      CREATE TABLE IF NOT EXISTS sku_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        delivery_method TEXT NOT NULL DEFAULT 'dm',
        channel_id TEXT,
        price_drop_threshold REAL,
        price_spike_threshold REAL,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, sku)
      );

      CREATE INDEX IF NOT EXISTS idx_subscriptions_sku ON sku_subscriptions(sku);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON sku_subscriptions(user_id);

      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY,
        quiet_start_hour INTEGER,
        quiet_end_hour INTEGER,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS product_cache (
        product_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        cached_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS summary_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        frequency TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        sent_at TEXT NOT NULL,
        UNIQUE(guild_id, frequency, period_start, period_end)
      );

      CREATE INDEX IF NOT EXISTS idx_summary_runs_guild ON summary_runs(guild_id, frequency, sent_at);

      CREATE TABLE IF NOT EXISTS exchange_rates (
        base_currency TEXT NOT NULL,
        target_currency TEXT NOT NULL,
        rate REAL NOT NULL,
        rate_date TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (base_currency, target_currency)
      );
    `);

    this.ensureAlertLogGuildColumn();
    this.ensureSubscriptionColumns();
  }

  private ensureAlertLogGuildColumn(): void {
    const columns = this.db.prepare('PRAGMA table_info(alert_log)').all() as { name: string }[];
    const columnNames = new Set(columns.map(column => column.name));

    if (!columnNames.has('guild_id')) {
      this.db.exec('ALTER TABLE alert_log ADD COLUMN guild_id TEXT');
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_alerts_product_type
      ON alert_log(guild_id, product_id, alert_type, sent_at)
    `);
  }

  private ensureSubscriptionColumns(): void {
    const columns = this.db
      .prepare('PRAGMA table_info(sku_subscriptions)')
      .all() as { name: string }[];
    const columnNames = new Set(columns.map(column => column.name));

    if (!columnNames.has('price_drop_threshold')) {
      this.db.exec('ALTER TABLE sku_subscriptions ADD COLUMN price_drop_threshold REAL');
    }

    if (!columnNames.has('price_spike_threshold')) {
      this.db.exec('ALTER TABLE sku_subscriptions ADD COLUMN price_spike_threshold REAL');
    }
  }

  migrateLegacyGlobalConfig(guildId: string, defaultChannelId: string | null): void {
    const markerKey = `legacy_guild_config_migrated_${guildId}`;
    if (this.getConfig(markerKey) === 'true') {
      return;
    }

    const existingGuildConfig = this.getAllGuildConfig(guildId);
    const globalConfig = this.getAllConfig();
    const now = new Date().toISOString();
    const upsertGuildConfig = this.db.prepare(`
      INSERT INTO guild_config (guild_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    const setGlobalConfig = this.db.prepare(`
      INSERT INTO bot_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    const updateLegacyAlerts = this.db.prepare(`
      UPDATE alert_log SET guild_id = ?
      WHERE guild_id IS NULL
    `);

    const transaction = this.db.transaction(() => {
      for (const [key, value] of Object.entries(globalConfig)) {
        if (key === 'initial_sync_complete' || key.startsWith('legacy_guild_config_migrated_')) {
          continue;
        }

        if (existingGuildConfig[key] === undefined) {
          upsertGuildConfig.run(guildId, key, value, now);
        }
      }

      for (const alertType of ALERT_TYPES) {
        const enabledKey = `alert_${alertType}_enabled`;
        const channelKey = `channel_${alertType}`;

        if (existingGuildConfig[enabledKey] === undefined && globalConfig[enabledKey] === undefined) {
          upsertGuildConfig.run(guildId, enabledKey, 'true', now);
        }

        if (
          defaultChannelId &&
          existingGuildConfig[channelKey] === undefined &&
          globalConfig[channelKey] === undefined
        ) {
          upsertGuildConfig.run(guildId, channelKey, defaultChannelId, now);
        }
      }

      updateLegacyAlerts.run(guildId);
      setGlobalConfig.run(markerKey, 'true', now);
    });

    transaction();
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

  getGuildConfig(guildId: string, key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM guild_config WHERE guild_id = ? AND key = ?');
    const row = stmt.get(guildId, key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setGuildConfig(guildId: string, key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO guild_config (guild_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    stmt.run(guildId, key, value, new Date().toISOString());
  }

  deleteGuildConfig(guildId: string, key: string): void {
    const stmt = this.db.prepare('DELETE FROM guild_config WHERE guild_id = ? AND key = ?');
    stmt.run(guildId, key);
  }

  getAllGuildConfig(guildId: string): Record<string, string> {
    const stmt = this.db.prepare('SELECT key, value FROM guild_config WHERE guild_id = ?');
    const rows = stmt.all(guildId) as { key: string; value: string }[];
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  getKnownGuildIds(): string[] {
    const stmt = this.db.prepare('SELECT DISTINCT guild_id FROM guild_config ORDER BY guild_id');
    const rows = stmt.all() as { guild_id: string }[];
    return rows.map(row => row.guild_id);
  }

  isInitialSyncComplete(): boolean {
    return this.getConfig('initial_sync_complete') === 'true';
  }

  markInitialSyncComplete(): void {
    this.setConfig('initial_sync_complete', 'true');
  }

  getBotSettings(guildId = DEFAULT_GUILD_ID): BotSettings {
    const config = this.getAllGuildConfig(guildId);
    const summaryFrequency = parseSummaryFrequency(config['summary_frequency']);
    const summaryLayout = parseSummaryLayout(config['summary_layout']);

    return {
      channelPriceDrop: config['channel_price_drop'] ?? null,
      channelPriceSpike: config['channel_price_spike'] ?? null,
      channelNewProduct: config['channel_new_product'] ?? null,
      channelBackInStock: config['channel_back_in_stock'] ?? null,
      alertPriceDropEnabled: config['alert_price_drop_enabled'] === 'true',
      alertPriceSpikeEnabled: config['alert_price_spike_enabled'] === 'true',
      alertNewProductEnabled: config['alert_new_product_enabled'] === 'true',
      alertBackInStockEnabled: config['alert_back_in_stock_enabled'] === 'true',
      priceDropThreshold: config['price_drop_threshold'] ? parseFloat(config['price_drop_threshold']) : null,
      priceSpikeThreshold: config['price_spike_threshold'] ? parseFloat(config['price_spike_threshold']) : null,
      pollIntervalMs: config['poll_interval_ms'] ? parseInt(config['poll_interval_ms'], 10) : null,
      alertCooldownMs: config['alert_cooldown_ms'] ? parseInt(config['alert_cooldown_ms'], 10) : null,
      summaryEnabled: config['summary_enabled'] === 'true',
      summaryFrequency,
      summaryChannelId: config['summary_channel_id'] ?? null,
      summaryTime: config['summary_time'] ?? null,
      summaryTimezone: config['summary_timezone'] ?? null,
      summaryLayout,
    };
  }

  setBotSetting(guildId: string, key: string, value: string | null): void {
    if (value === null) {
      this.deleteGuildConfig(guildId, key);
    } else {
      this.setGuildConfig(guildId, key, value);
    }
  }

  resetBotSettings(guildId: string): void {
    const stmt = this.db.prepare('DELETE FROM guild_config WHERE guild_id = ?');
    stmt.run(guildId);
  }

  getGuildAlertTargets(alertType: AlertType): { guildId: string; settings: BotSettings; channelId: string }[] {
    const enabledKey = `alert_${alertType}_enabled`;
    const stmt = this.db.prepare(`
      SELECT DISTINCT guild_id FROM guild_config
      WHERE key = ? AND value = 'true'
      ORDER BY guild_id
    `);
    const rows = stmt.all(enabledKey) as { guild_id: string }[];

    return rows.flatMap(row => {
      const settings = this.getBotSettings(row.guild_id);
      const channelId = getAlertChannelId(settings, alertType);

      if (!isAlertEnabled(settings, alertType) || !channelId) {
        return [];
      }

      return [{ guildId: row.guild_id, settings, channelId }];
    });
  }

  getMinimumAlertThresholds(fallbacks: { priceDropThreshold: number; priceSpikeThreshold: number }): {
    priceDropThreshold: number;
    priceSpikeThreshold: number;
  } {
    const guildIds = this.getKnownGuildIds();
    let priceDropThreshold = fallbacks.priceDropThreshold;
    let priceSpikeThreshold = fallbacks.priceSpikeThreshold;

    for (const guildId of guildIds) {
      const settings = this.getBotSettings(guildId);
      if (settings.alertPriceDropEnabled) {
        priceDropThreshold = Math.min(
          priceDropThreshold,
          settings.priceDropThreshold ?? fallbacks.priceDropThreshold
        );
      }
      if (settings.alertPriceSpikeEnabled) {
        priceSpikeThreshold = Math.min(
          priceSpikeThreshold,
          settings.priceSpikeThreshold ?? fallbacks.priceSpikeThreshold
        );
      }
    }

    return { priceDropThreshold, priceSpikeThreshold };
  }

  getSummarySettings(guildId: string): SummarySettings {
    const settings = this.getBotSettings(guildId);
    return {
      guildId,
      summaryEnabled: settings.summaryEnabled,
      frequency: settings.summaryFrequency,
      channelId: settings.summaryChannelId,
      time: settings.summaryTime,
      timezone: settings.summaryTimezone,
      layout: settings.summaryLayout,
    };
  }

  setSummarySettings(
    guildId: string,
    values: {
      enabled: boolean;
      frequency: SummaryFrequency;
      channelId: string;
      time: string;
      timezone: string;
      layout?: SummaryLayout;
    }
  ): void {
    const now = new Date().toISOString();
    const layout = values.layout ?? parseSummaryLayout(this.getGuildConfig(guildId, 'summary_layout'));
    const stmt = this.db.prepare(`
      INSERT INTO guild_config (guild_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    const transaction = this.db.transaction(() => {
      stmt.run(guildId, 'summary_enabled', values.enabled.toString(), now);
      stmt.run(guildId, 'summary_frequency', values.frequency, now);
      stmt.run(guildId, 'summary_channel_id', values.channelId, now);
      stmt.run(guildId, 'summary_time', values.time, now);
      stmt.run(guildId, 'summary_timezone', values.timezone, now);
      stmt.run(guildId, 'summary_layout', layout, now);
    });

    transaction();
  }

  disableSummary(guildId: string): void {
    this.setGuildConfig(guildId, 'summary_enabled', 'false');
  }

  getEnabledSummarySettings(): EnabledSummarySettings[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT guild_id FROM guild_config
      WHERE key = 'summary_enabled' AND value = 'true'
      ORDER BY guild_id
    `);
    const rows = stmt.all() as { guild_id: string }[];

    return rows.flatMap(row => {
      const settings = this.getSummarySettings(row.guild_id);
      if (
        !settings.summaryEnabled ||
        !settings.frequency ||
        !settings.channelId ||
        !settings.time ||
        !settings.timezone
      ) {
        return [];
      }

      return [{
        guildId: settings.guildId,
        summaryEnabled: true,
        frequency: settings.frequency,
        channelId: settings.channelId,
        time: settings.time,
        timezone: settings.timezone,
        layout: settings.layout,
      }];
    });
  }

  hasSummaryRun(guildId: string, frequency: SummaryFrequency, periodStart: string, periodEnd: string): boolean {
    const stmt = this.db.prepare(`
      SELECT id FROM summary_runs
      WHERE guild_id = ? AND frequency = ? AND period_start = ? AND period_end = ?
      LIMIT 1
    `);
    return stmt.get(guildId, frequency, periodStart, periodEnd) !== undefined;
  }

  recordSummaryRun(run: SummaryRun): boolean {
    const stmt = this.db.prepare(`
      INSERT INTO summary_runs (
        guild_id,
        frequency,
        period_start,
        period_end,
        channel_id,
        message_id,
        sent_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        run.guildId,
        run.frequency,
        run.periodStart,
        run.periodEnd,
        run.channelId,
        run.messageId,
        run.sentAt
      );
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        return false;
      }
      throw error;
    }
  }

  getExchangeRate(baseCurrency: string, targetCurrency: string): ExchangeRate | null {
    const stmt = this.db.prepare(`
      SELECT base_currency, target_currency, rate, rate_date, fetched_at
      FROM exchange_rates
      WHERE base_currency = ? AND target_currency = ?
    `);
    const row = stmt.get(baseCurrency.toUpperCase(), targetCurrency.toUpperCase()) as ExchangeRateRow | undefined;
    if (!row) {
      return null;
    }

    return {
      baseCurrency: row.base_currency,
      targetCurrency: row.target_currency,
      rate: row.rate,
      rateDate: row.rate_date,
      fetchedAt: row.fetched_at,
      stale: false,
    };
  }

  upsertExchangeRate(rate: Omit<ExchangeRate, 'stale'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO exchange_rates (base_currency, target_currency, rate, rate_date, fetched_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(base_currency, target_currency) DO UPDATE SET
        rate = excluded.rate,
        rate_date = excluded.rate_date,
        fetched_at = excluded.fetched_at
    `);
    stmt.run(
      rate.baseCurrency.toUpperCase(),
      rate.targetCurrency.toUpperCase(),
      rate.rate,
      rate.rateDate,
      rate.fetchedAt
    );
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

  logAlert(guildId: string, productId: string, alertType: AlertType): void {
    const stmt = this.db.prepare(`
      INSERT INTO alert_log (guild_id, product_id, alert_type, sent_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(guildId, productId, alertType, new Date().toISOString());
  }

  canSendAlert(guildId: string, productId: string, alertType: AlertType, cooldownMs: number): boolean {
    const stmt = this.db.prepare(`
      SELECT sent_at FROM alert_log 
      WHERE guild_id = ? AND product_id = ? AND alert_type = ?
      ORDER BY sent_at DESC LIMIT 1
    `);

    const row = stmt.get(guildId, productId, alertType) as { sent_at: string } | undefined;
    if (!row) return true;

    const lastSent = new Date(row.sent_at).getTime();
    const now = Date.now();
    return (now - lastSent) >= cooldownMs;
  }

  getAlertLogs(
    guildId: string,
    alertTypes: AlertType[],
    periodStart: string,
    periodEnd: string
  ): { productId: string; alertType: AlertType; sentAt: string }[] {
    if (alertTypes.length === 0) {
      return [];
    }

    const placeholders = alertTypes.map(() => '?').join(', ');
    const stmt = this.db.prepare(`
      SELECT product_id, alert_type, sent_at
      FROM alert_log
      WHERE guild_id = ?
        AND alert_type IN (${placeholders})
        AND sent_at >= ?
        AND sent_at < ?
      ORDER BY sent_at DESC
    `);
    const rows = stmt.all(guildId, ...alertTypes, periodStart, periodEnd) as AlertLogRow[];

    return rows.map(row => ({
      productId: row.product_id,
      alertType: row.alert_type as AlertType,
      sentAt: row.sent_at,
    }));
  }

  addSkuSubscription(userId: string, sku: string, deliveryMethod: 'dm' | 'channel', channelId: string | null): boolean {
    return this.addSkuSubscriptions(userId, [sku], deliveryMethod, channelId).added.length > 0;
  }

  addSkuSubscriptions(
    userId: string,
    skus: string[],
    deliveryMethod: 'dm' | 'channel',
    channelId: string | null,
    thresholds?: { priceDropThreshold?: number; priceSpikeThreshold?: number }
  ): { added: string[]; duplicates: string[] } {
    const insert = this.db.prepare(`
      INSERT INTO sku_subscriptions (
        user_id,
        sku,
        delivery_method,
        channel_id,
        price_drop_threshold,
        price_spike_threshold,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    const added: string[] = [];
    const duplicates: string[] = [];

    const transaction = this.db.transaction((values: string[]) => {
      for (const sku of values) {
        try {
          insert.run(
            userId,
            sku.toUpperCase(),
            deliveryMethod,
            channelId,
            thresholds?.priceDropThreshold ?? null,
            thresholds?.priceSpikeThreshold ?? null,
            now
          );
          added.push(sku.toUpperCase());
        } catch (error: unknown) {
          if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
            duplicates.push(sku.toUpperCase());
          } else {
            throw error;
          }
        }
      }
    });

    transaction(skus);

    return { added, duplicates };
  }

  removeSkuSubscription(userId: string, sku: string): boolean {
    return this.removeSkuSubscriptions(userId, [sku]).removed.length > 0;
  }

  removeSkuSubscriptions(userId: string, skus: string[]): { removed: string[]; missing: string[] } {
    const stmt = this.db.prepare(`
      DELETE FROM sku_subscriptions WHERE user_id = ? AND sku = ?
    `);

    const removed: string[] = [];
    const missing: string[] = [];

    const transaction = this.db.transaction((values: string[]) => {
      for (const sku of values) {
        const result = stmt.run(userId, sku.toUpperCase());
        if (result.changes > 0) {
          removed.push(sku.toUpperCase());
        } else {
          missing.push(sku.toUpperCase());
        }
      }
    });

    transaction(skus);

    return { removed, missing };
  }

  getUserSubscriptions(userId: string): SkuSubscription[] {
    const stmt = this.db.prepare(`
      SELECT id, user_id, sku, delivery_method, channel_id, price_drop_threshold, price_spike_threshold, created_at
      FROM sku_subscriptions WHERE user_id = ?
    `);
    return stmt.all(userId) as SkuSubscription[];
  }

  getSubscribersForSku(sku: string): SkuSubscription[] {
    const stmt = this.db.prepare(`
      SELECT id, user_id, sku, delivery_method, channel_id, price_drop_threshold, price_spike_threshold, created_at
      FROM sku_subscriptions WHERE sku = ?
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

  getUserPreferences(userId: string): UserPreferences | null {
    const stmt = this.db.prepare(`
      SELECT user_id, quiet_start_hour, quiet_end_hour, updated_at
      FROM user_preferences WHERE user_id = ?
    `);
    const row = stmt.get(userId) as UserPreferences | undefined;
    return row ?? null;
  }

  upsertUserPreferences(userId: string, quietStartHour: number | null, quietEndHour: number | null): void {
    const stmt = this.db.prepare(`
      INSERT INTO user_preferences (user_id, quiet_start_hour, quiet_end_hour, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        quiet_start_hour = excluded.quiet_start_hour,
        quiet_end_hour = excluded.quiet_end_hour,
        updated_at = excluded.updated_at
    `);
    stmt.run(userId, quietStartHour, quietEndHour, new Date().toISOString());
  }

  upsertCachedProducts(products: Product[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO product_cache (product_id, data, cached_at)
      VALUES (?, ?, ?)
      ON CONFLICT(product_id) DO UPDATE SET
        data = excluded.data,
        cached_at = excluded.cached_at
    `);
    const clearStmt = this.db.prepare('DELETE FROM product_cache');
    const now = new Date().toISOString();
    const transaction = this.db.transaction((items: Product[]) => {
      for (const product of items) {
        stmt.run(product.id, JSON.stringify(product), now);
      }

      if (items.length === 0) {
        clearStmt.run();
        return;
      }

      const deleteMissingStmt = this.db.prepare(`
        DELETE FROM product_cache
        WHERE product_id NOT IN (${items.map(() => '?').join(', ')})
      `);
      deleteMissingStmt.run(...items.map(product => product.id));
    });
    transaction(products);
  }

  getCachedProducts(): Product[] {
    const stmt = this.db.prepare('SELECT data FROM product_cache');
    const rows = stmt.all() as { data: string }[];
    return rows.map(r => JSON.parse(r.data) as Product);
  }

  close(): void {
    this.db.close();
  }
}

function parseSummaryFrequency(value: string | undefined): SummaryFrequency | null {
  if (!value) {
    return null;
  }

  return SUMMARY_FREQUENCIES.includes(value as SummaryFrequency) ? value as SummaryFrequency : null;
}

function parseSummaryLayout(value: string | undefined | null): SummaryLayout {
  return SUMMARY_LAYOUTS.includes(value as SummaryLayout) ? value as SummaryLayout : 'compact';
}

function getAlertChannelId(settings: BotSettings, alertType: AlertType): string | null {
  switch (alertType) {
    case 'price_drop':
      return settings.channelPriceDrop;
    case 'price_spike':
      return settings.channelPriceSpike;
    case 'new_product':
      return settings.channelNewProduct;
    case 'back_in_stock':
      return settings.channelBackInStock;
  }
}

function isAlertEnabled(settings: BotSettings, alertType: AlertType): boolean {
  switch (alertType) {
    case 'price_drop':
      return settings.alertPriceDropEnabled;
    case 'price_spike':
      return settings.alertPriceSpikeEnabled;
    case 'new_product':
      return settings.alertNewProductEnabled;
    case 'back_in_stock':
      return settings.alertBackInStockEnabled;
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

interface ExchangeRateRow {
  base_currency: string;
  target_currency: string;
  rate: number;
  rate_date: string;
  fetched_at: string;
}

interface AlertLogRow {
  product_id: string;
  alert_type: string;
  sent_at: string;
}
