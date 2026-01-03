# OnlyDrives Alert Bot - Technical Specification

## Overview

A Discord bot that monitors drive prices from the OnlyDrives API and alerts users when significant price changes occur (spikes or drops).

## Data Source

### API Endpoints
- **Base URL**: `https://onlydrives.tx.au/api`

#### Products List
- **Endpoint**: `GET /api/products`
- Returns: Array of all products (~132 items)
- Supports query param: `?sku=<sku>` for filtering
- No pagination required (small dataset)

#### Price History
- **Endpoint**: `GET /api/sku/{source}-{sku}/price-history`
- Example: `GET /api/sku/east-digital-ST22000NM000C-R/price-history`
- Returns: Array of historical price snapshots (oldest to newest)
- Key insight: **API provides full price history** - no local storage needed for historical data
- Bot only needs to track "last alerted price" to detect significant changes

```typescript
interface PriceHistoryEntry {
  recorded_at: string;    // ISO timestamp (e.g., "2026-01-02T22:40:00.675Z")
  price_total: string;    // Total price in AUD (e.g., "483.00")
  price_per_tb: string;   // Price per TB (e.g., "21.95")
}
```

### Product Schema
```typescript
interface Product {
  id: string;                    // Unique product ID (e.g., "51824083435793")
  sku: string;                   // Product SKU (e.g., "ST22000NM000C-R")
  name: string;                  // Full product name
  type: "HDD" | "SSD";           // Drive type
  condition: string;             // "New" | "Recertified" | "Pull (Used)" | "Mixed"
  capacity_tb: string;           // Capacity in TB (string, e.g., "22.00")
  url: string;                   // Link to product page
  image_url: string;             // Product image URL
  available: boolean;            // Stock availability
  current_price_total: string;   // Total price in AUD (string, e.g., "483.00")
  current_price_per_tb: string;  // Price per TB (string, e.g., "21.95")
  last_seen_at: string;          // ISO timestamp
  first_seen_at: string;         // ISO timestamp
  updated_at: string;            // ISO timestamp
  source: string;                // Retailer source (e.g., "east-digital", "neology")
}
```

## Functional Requirements

### Core Features

1. **Price Monitoring**
   - Poll `/api/products` at configurable intervals (default: 5 minutes)
   - Compare current prices against last known state in local DB
   - Track both `current_price_total` and `current_price_per_tb`
   - Use `/api/sku/{source}-{sku}/price-history` for historical context in alerts

2. **Alert Detection**
   - **Price Drop Alert**: When price decreases by configurable threshold (default: 5%)
   - **Price Spike Alert**: When price increases by configurable threshold (default: 10%)
   - **New Product Alert**: When a previously unseen product appears
   - **Back in Stock Alert**: When `available` changes from false to true

3. **Discord Notifications**
   - Send rich embed messages to configured channel(s)
   - Include: product name, old price, new price, % change, link, thumbnail
   - Color coding: Green for drops, Red for spikes, Blue for new/stock

4. **Slash Commands**
   - `/status` - Show bot status and last check time
   - `/deals [--type HDD|SSD] [--min-tb N]` - List current best $/TB deals
   - `/history <sku>` - Show price history chart/summary for a product
   - `/watch <sku>` - Add a product to personal watchlist (future extension point)
   - `/config` - View/modify alert settings (admin only)

### Alert Rate Limiting
- Deduplicate alerts: Same product alert max once per 4 hours
- Global rate limit: Max 10 alerts per minute to avoid spam

## Non-Functional Requirements

1. **Reliability**: Graceful handling of API failures, auto-retry with backoff
2. **Extensibility**: Plugin architecture for adding new alert types/monitors
3. **Simplicity**: Minimal dependencies, single process, lightweight SQLite for state only (history from API)
4. **Observability**: Structured logging with configurable levels

## Technical Architecture

### Stack
- **Runtime**: Node.js 20+
- **Language**: TypeScript (strict mode)
- **Discord Library**: discord.js v14+
- **Database**: SQLite via better-sqlite3 (sync, simple)
- **Testing**: Vitest
- **Build**: tsup (fast, simple bundling)

### Directory Structure
```
onlydrives_alert_bot/
├── src/
│   ├── index.ts              # Entry point
│   ├── bot.ts                # Discord client setup
│   ├── config.ts             # Configuration loading
│   ├── types.ts              # Shared TypeScript types
│   ├── commands/             # Slash command handlers
│   │   ├── index.ts          # Command loader
│   │   ├── status.ts
│   │   ├── deals.ts
│   │   └── history.ts
│   ├── monitors/             # Background monitoring
│   │   ├── index.ts          # Monitor orchestrator
│   │   └── price-monitor.ts  # Price change detection
│   ├── services/             # Business logic
│   │   ├── api.ts            # OnlyDrives API client
│   │   ├── database.ts       # SQLite operations
│   │   ├── alerter.ts        # Discord notification sending
│   │   └── rate-limiter.ts   # Alert deduplication
│   └── utils/
│       ├── embed.ts          # Discord embed builders
│       └── logger.ts         # Logging utility
├── tests/
│   ├── services/
│   │   ├── api.test.ts
│   │   ├── database.test.ts
│   │   └── price-monitor.test.ts
│   └── fixtures/
│       └── products.json     # Sample API response
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .env.example
```

### Database Schema
```sql
-- Track last known state for each product (for change detection)
CREATE TABLE product_state (
  product_id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  source TEXT NOT NULL,
  last_price_total REAL NOT NULL,
  last_price_per_tb REAL NOT NULL,
  last_available INTEGER NOT NULL,  -- 0 or 1
  last_checked_at TEXT NOT NULL,    -- ISO timestamp
  first_seen_at TEXT NOT NULL       -- ISO timestamp (for "new product" detection)
);

CREATE INDEX idx_state_sku ON product_state(sku);

-- Alert deduplication (prevent spam)
CREATE TABLE alert_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,    -- 'price_drop', 'price_spike', 'new', 'restock'
  sent_at TEXT NOT NULL
);

CREATE INDEX idx_alerts_product_type ON alert_log(product_id, alert_type, sent_at);
```

**Note**: Full price history is available via the API's `/api/sku/{source}-{sku}/price-history` endpoint. The bot only stores minimal state needed for change detection and alert deduplication.

### Configuration
Environment variables (via `.env`):
```
DISCORD_TOKEN=<bot token>
DISCORD_CLIENT_ID=<application client id>
DISCORD_GUILD_ID=<server id for dev, optional for global>
ALERT_CHANNEL_ID=<channel to send alerts>

# Optional
POLL_INTERVAL_MS=300000        # 5 minutes default
PRICE_DROP_THRESHOLD=0.05      # 5% default
PRICE_SPIKE_THRESHOLD=0.10     # 10% default
ALERT_COOLDOWN_MS=14400000     # 4 hours default
LOG_LEVEL=info                 # debug|info|warn|error
```

### Discord Gateway Intents
Minimal required intents:
- `GatewayIntentBits.Guilds` - Required for guild operations
- No privileged intents needed (slash commands don't require MessageContent)

## Alert Embed Format

### Price Drop Alert
```
[Green sidebar]
Title: Price Drop Alert
Thumbnail: [product image]

**Seagate Exos 22TB ST22000NM000C** (HDD)
Condition: Recertified

Price: ~~$520.00~~ → **$483.00** (-7.1%)
$/TB: $23.64 → **$21.95**

Source: east-digital
[View Deal](url)

Footer: OnlyDrives Monitor | [timestamp]
```

## Extension Points

The architecture supports future additions:
1. **New Alert Types**: Implement `AlertDetector` interface
2. **New Data Sources**: Implement `ProductFetcher` interface  
3. **User Watchlists**: Add users table, subscription commands
4. **Price Predictions**: Add trend analysis based on history
5. **Multi-Guild**: Support multiple Discord servers with different configs

## Testing Strategy

1. **Unit Tests**: Services in isolation (API client, database, alerter)
2. **Integration Tests**: Monitor with real API data (read-only, safe)
3. **No E2E Discord Tests**: Mock discord.js client for command tests

### Test Data
- Use real API responses saved as fixtures
- Tests should be deterministic (mock timestamps)

## Deployment

Simple single-process deployment:
1. Clone repo
2. `npm install`
3. Copy `.env.example` to `.env`, fill values
4. `npm run db:init` (create SQLite DB)
5. `npm run deploy-commands` (register slash commands)
6. `npm start` (production) or `npm run dev` (development)

### Production Considerations
- Run via PM2 or systemd for process management
- SQLite file should be on persistent storage
- Bot token should be kept secret (use secrets manager in production)
