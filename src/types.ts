export interface Product {
  id: string;
  sku: string;
  name: string;
  type: 'HDD' | 'SSD';
  condition: string;
  capacity_tb: string;
  url: string;
  image_url: string;
  available: boolean;
  current_price_total: string;
  current_price_per_tb: string;
  last_seen_at: string;
  first_seen_at: string;
  updated_at: string;
  source: string;
}

export interface PriceHistoryEntry {
  recorded_at: string;
  price_total: string;
  price_per_tb: string;
}

export interface ProductState {
  product_id: string;
  sku: string;
  source: string;
  last_price_total: number;
  last_price_per_tb: number;
  last_available: boolean;
  last_checked_at: string;
  first_seen_at: string;
}

export type AlertType = 'price_drop' | 'price_spike' | 'new_product' | 'back_in_stock';

export interface AlertEvent {
  type: AlertType;
  product: Product;
  previousPrice?: number;
  currentPrice: number;
  percentChange?: number;
}

export interface Config {
  discord: {
    token: string;
    clientId: string;
    guildId?: string;
    alertChannelId: string;
  };
  monitoring: {
    pollIntervalMs: number;
    priceDropThreshold: number;
    priceSpikeThreshold: number;
    alertCooldownMs: number;
  };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
