import type { Product, ProductState, AlertEvent } from '../types.js';

interface PriceMonitorConfig {
  priceDropThreshold: number;
  priceSpikeThreshold: number;
}

export class PriceMonitor {
  private config: PriceMonitorConfig;

  constructor(config: PriceMonitorConfig) {
    this.config = config;
  }

  detectChanges(product: Product, previousState: ProductState | null): AlertEvent[] {
    const alerts: AlertEvent[] = [];
    const currentPrice = PriceMonitor.parsePrice(product.current_price_total);

    if (!previousState) {
      alerts.push({
        type: 'new_product',
        product,
        currentPrice,
      });
      return alerts;
    }

    const previousPrice = previousState.last_price_total;
    const percentChange = (currentPrice - previousPrice) / previousPrice;

    if (percentChange <= -this.config.priceDropThreshold) {
      alerts.push({
        type: 'price_drop',
        product,
        previousPrice,
        currentPrice,
        percentChange,
      });
    } else if (percentChange >= this.config.priceSpikeThreshold) {
      alerts.push({
        type: 'price_spike',
        product,
        previousPrice,
        currentPrice,
        percentChange,
      });
    }

    if (product.available && !previousState.last_available) {
      alerts.push({
        type: 'back_in_stock',
        product,
        currentPrice,
      });
    }

    return alerts;
  }

  static parsePrice(priceString: string): number {
    if (!priceString) return 0;
    const parsed = parseFloat(priceString);
    return isNaN(parsed) ? 0 : parsed;
  }
}
