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

export type SummaryFrequency = 'daily' | 'weekly' | 'monthly';

export type SummaryLayout = 'compact' | 'detailed';

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
    summaryTestGuildId?: string;
  };
  monitoring: {
    pollIntervalMs: number;
    priceDropThreshold: number;
    priceSpikeThreshold: number;
    alertCooldownMs: number;
  };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface BotSettings {
  channelPriceDrop: string | null;
  channelPriceSpike: string | null;
  channelNewProduct: string | null;
  channelBackInStock: string | null;
  alertPriceDropEnabled: boolean;
  alertPriceSpikeEnabled: boolean;
  alertNewProductEnabled: boolean;
  alertBackInStockEnabled: boolean;
  priceDropThreshold: number | null;
  priceSpikeThreshold: number | null;
  pollIntervalMs: number | null;
  alertCooldownMs: number | null;
  summaryEnabled: boolean;
  summaryFrequency: SummaryFrequency | null;
  summaryChannelId: string | null;
  summaryTime: string | null;
  summaryTimezone: string | null;
  summaryLayout: SummaryLayout;
}

export interface SummarySettings {
  guildId: string;
  summaryEnabled: boolean;
  frequency: SummaryFrequency | null;
  channelId: string | null;
  time: string | null;
  timezone: string | null;
  layout: SummaryLayout;
}

export interface EnabledSummarySettings {
  guildId: string;
  summaryEnabled: true;
  frequency: SummaryFrequency;
  channelId: string;
  time: string;
  timezone: string;
  layout: SummaryLayout;
}

export interface ExchangeRate {
  baseCurrency: string;
  targetCurrency: string;
  rate: number;
  rateDate: string;
  fetchedAt: string;
  stale: boolean;
}

export interface SummaryRun {
  guildId: string;
  frequency: SummaryFrequency;
  periodStart: string;
  periodEnd: string;
  channelId: string;
  messageId: string | null;
  sentAt: string;
}

export interface SkuSubscription {
  id: number;
  user_id: string;
  sku: string;
  delivery_method: 'dm' | 'channel';
  channel_id: string | null;
  price_drop_threshold: number | null;
  price_spike_threshold: number | null;
  created_at: string;
}

export interface UserPreferences {
  user_id: string;
  quiet_start_hour: number | null;
  quiet_end_hour: number | null;
  updated_at: string;
}
