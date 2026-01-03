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
      config.monitoring
    );
  }

  start(): void {
    const settings = this.db.getBotSettings();
    const pollInterval = settings.pollIntervalMs ?? this.config.monitoring.pollIntervalMs;
    
    console.log(`[Monitor] Starting price monitor (interval: ${pollInterval}ms)`);
    
    this.runCheck().catch(console.error);
    
    this.intervalId = setInterval(() => {
      this.runCheck().catch(console.error);
    }, pollInterval);
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

      const isFirstRun = !this.db.isInitialSyncComplete();
      if (isFirstRun) {
        console.log('[Monitor] First run detected - syncing products without alerts');
      }

      const settings = this.db.getBotSettings();
      this.priceMonitor = new PriceMonitor({
        priceDropThreshold: settings.priceDropThreshold ?? this.config.monitoring.priceDropThreshold,
        priceSpikeThreshold: settings.priceSpikeThreshold ?? this.config.monitoring.priceSpikeThreshold,
      });

      let alertCount = 0;
      let subscriptionAlertCount = 0;

      for (const product of products) {
        const previousState = this.db.getProductState(product.id);
        const alerts = this.priceMonitor.detectChanges(product, previousState);

        // Track if a price-related alert was sent (affects whether we update baseline price)
        let priceAlertSent = false;

        if (!isFirstRun) {
          for (const alert of alerts) {
            const sent = await this.alerter.sendAlert(alert);
            if (sent) {
              alertCount++;
              if (alert.type === 'price_drop' || alert.type === 'price_spike') {
                priceAlertSent = true;
              }
            }
            
            if (alert.type === 'price_drop' || alert.type === 'price_spike' || alert.type === 'back_in_stock') {
              const subSent = await this.alerter.sendSubscriptionAlerts(alert);
              subscriptionAlertCount += subSent;
            }
          }
        }

        // Only update baseline price when:
        // 1. First run (initial sync) - establish baseline
        // 2. A price alert was sent - reset baseline to current price
        // This prevents incremental price changes from "creeping" the baseline
        // without triggering alerts (e.g., 2% + 2% + 2% should still alert at 6%)
        const shouldUpdatePrice = isFirstRun || priceAlertSent || !previousState;
        
        const newState: ProductState = {
          product_id: product.id,
          sku: product.sku,
          source: product.source,
          last_price_total: shouldUpdatePrice 
            ? PriceMonitor.parsePrice(product.current_price_total)
            : previousState!.last_price_total,
          last_price_per_tb: shouldUpdatePrice
            ? PriceMonitor.parsePrice(product.current_price_per_tb)
            : previousState!.last_price_per_tb,
          last_available: product.available,
          last_checked_at: new Date().toISOString(),
          first_seen_at: previousState?.first_seen_at ?? new Date().toISOString(),
        };

        this.db.upsertProductState(newState);
      }

      if (isFirstRun) {
        this.db.markInitialSyncComplete();
        console.log(`[Monitor] Initial sync complete. Indexed ${products.length} products. Future runs will send alerts.`);
      } else {
        console.log(`[Monitor] Check complete. Sent ${alertCount} channel alerts, ${subscriptionAlertCount} subscription alerts.`);
      }
    } catch (error) {
      console.error('[Monitor] Error during price check:', error);
    }
  }
}
