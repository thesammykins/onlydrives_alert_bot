import type { Client } from 'discord.js';
import { OnlyDrivesApi } from '../services/api.js';
import { Database } from '../services/database.js';
import { PriceMonitor } from '../services/price-monitor.js';
import { Alerter } from '../services/alerter.js';
import type { Config, ProductState } from '../types.js';

export class MonitorOrchestrator {
  private client: Client;
  private config: Config;
  private api: OnlyDrivesApi;
  private db: Database;
  private priceMonitor: PriceMonitor;
  private alerter: Alerter;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(client: Client, config: Config, db: Database) {
    this.client = client;
    this.config = config;
    this.api = new OnlyDrivesApi();
    this.db = db;
    this.priceMonitor = new PriceMonitor({
      priceDropThreshold: config.monitoring.priceDropThreshold,
      priceSpikeThreshold: config.monitoring.priceSpikeThreshold,
    });
    this.alerter = new Alerter(
      client,
      config.discord.alertChannelId,
      db,
      config.monitoring.alertCooldownMs
    );
  }

  start(): void {
    console.log(`[Monitor] Starting price monitor (interval: ${this.config.monitoring.pollIntervalMs}ms)`);
    
    this.runCheck().catch(console.error);
    
    this.intervalId = setInterval(() => {
      this.runCheck().catch(console.error);
    }, this.config.monitoring.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[Monitor] Stopped price monitor');
    }
  }

  async runCheck(): Promise<void> {
    console.log('[Monitor] Running price check...');
    
    try {
      const products = await this.api.fetchProducts();
      console.log(`[Monitor] Fetched ${products.length} products`);

      let alertCount = 0;

      for (const product of products) {
        const previousState = this.db.getProductState(product.id);
        const alerts = this.priceMonitor.detectChanges(product, previousState);

        for (const alert of alerts) {
          const sent = await this.alerter.sendAlert(alert);
          if (sent) alertCount++;
        }

        const newState: ProductState = {
          product_id: product.id,
          sku: product.sku,
          source: product.source,
          last_price_total: PriceMonitor.parsePrice(product.current_price_total),
          last_price_per_tb: PriceMonitor.parsePrice(product.current_price_per_tb),
          last_available: product.available,
          last_checked_at: new Date().toISOString(),
          first_seen_at: previousState?.first_seen_at ?? new Date().toISOString(),
        };

        this.db.upsertProductState(newState);
      }

      console.log(`[Monitor] Check complete. Sent ${alertCount} alerts.`);
    } catch (error) {
      console.error('[Monitor] Error during price check:', error);
    }
  }
}
