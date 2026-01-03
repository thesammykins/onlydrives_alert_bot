# OnlyDrives Alert Bot

A Discord bot that monitors drive prices from the OnlyDrives API and alerts users when significant price changes occur.

## Features

- **Price Monitoring**: Polls products at configurable intervals (default: 5 minutes)
- **Price Drop Alerts**: Notified when prices decrease by threshold (default: 5%)
- **Price Spike Alerts**: Notified when prices increase by threshold (default: 10%)
- **New Product Alerts**: Notified when new products appear
- **Back in Stock Alerts**: Notified when products become available again
- **Personal SKU Alerts**: Subscribe to specific SKUs and receive alerts via DM or in-channel
- **Slash Commands**:
  - `/status` - Show bot status and last check time
  - `/deals` - List current best $/TB deals with optional filters
  - `/history <sku>` - Show price history for a product
  - `/config` - Configure bot settings at runtime (Admin only)
  - `/alert` - Manage personal SKU price alert subscriptions
- **@Bot Mention Commands**: Subscribe to alerts by mentioning the bot
- **Runtime Configuration**: All settings can be configured via `/config` command
- **Per-Alert Channels**: Route different alert types to different channels
- **Alert Toggles**: Enable/disable specific alert types
- **Silent First Run**: No spam on first startup - products are synced silently

## Prerequisites

- Docker and Docker Compose (recommended), OR
- Node.js 20 or higher
- A Discord account with permissions to create applications

## Discord Bot Setup

### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**
3. Enter a name (e.g., "OnlyDrives Alert Bot") and click **Create**
4. Copy the **Application ID** (also called Client ID) - you'll need this for `DISCORD_CLIENT_ID`

### 2. Create a Bot User

1. In your application, go to the **Bot** tab in the left sidebar
2. Click **Add Bot** and confirm
3. Under **Token**, click **Reset Token** and confirm
4. Copy the token immediately - you'll need this for `DISCORD_TOKEN`
   > **Warning**: Never share your bot token. If exposed, reset it immediately.

### 3. Configure Bot Permissions

Still in the **Bot** tab:

1. Scroll down to **Privileged Gateway Intents**
   - Enable **Message Content Intent** (required for @mention commands)
2. Under **Bot Permissions**, the bot needs:
   - `Send Messages`
   - `Embed Links`
   - `Use Slash Commands`

### 4. Generate an Invite Link

1. Go to the **OAuth2** tab, then **URL Generator**
2. Under **Scopes**, select:
   - `bot`
   - `applications.commands`
3. Under **Bot Permissions**, select:
   - `Send Messages`
   - `Embed Links`
4. Copy the generated URL at the bottom
5. Open this URL in your browser to invite the bot to your server
6. Select your server and authorize

### 5. Get Channel and Guild IDs

To get the IDs needed for configuration:

1. Open Discord and go to **User Settings** > **Advanced**
2. Enable **Developer Mode**
3. Right-click on your server name and select **Copy Server ID** - this is your `DISCORD_GUILD_ID`
4. Right-click on the channel where you want alerts and select **Copy Channel ID** - this is your `ALERT_CHANNEL_ID`

## Installation

### Option 1: Docker Compose (Recommended)

1. Clone the repository:
   ```bash
   git clone https://github.com/thesammykins/onlydrives_alert_bot.git
   cd onlydrives_alert_bot
   ```

2. Create your environment file:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your configuration:
   ```bash
   # Required
   DISCORD_TOKEN=your_bot_token_here
   DISCORD_CLIENT_ID=your_client_id_here
   DISCORD_GUILD_ID=your_guild_id_here
   ALERT_CHANNEL_ID=channel_id_for_alerts

   # Optional (defaults shown)
   POLL_INTERVAL_MS=300000
   PRICE_DROP_THRESHOLD=0.05
   PRICE_SPIKE_THRESHOLD=0.10
   ALERT_COOLDOWN_MS=14400000
   LOG_LEVEL=info
   ```

4. Deploy slash commands (one-time setup):
   ```bash
   docker compose run --rm bot npm run deploy-commands
   ```

5. Start the bot:
   ```bash
   docker compose up -d
   ```

6. View logs:
   ```bash
   docker compose logs -f
   ```

### Option 2: Local Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/thesammykins/onlydrives_alert_bot.git
   cd onlydrives_alert_bot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create your environment file:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` with your configuration (see above)

5. Initialize the database:
   ```bash
   npm run db:init
   ```

6. Deploy slash commands (one-time setup):
   ```bash
   npm run deploy-commands
   ```

7. Build and start:
   ```bash
   npm run build
   npm start
   ```

   For development with auto-reload:
   ```bash
   npm run dev
   ```

## Configuration Options

Settings can be configured via `.env` file OR the `/config` command. Runtime settings (via `/config`) take precedence.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | Yes | - | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | - | Application/Client ID from Discord Developer Portal |
| `DISCORD_GUILD_ID` | No | - | Server ID (for dev; omit for global commands) |
| `ALERT_CHANNEL_ID` | Yes | - | Default channel ID where alerts will be sent |
| `POLL_INTERVAL_MS` | No | 300000 | How often to check prices (5 min default) |
| `PRICE_DROP_THRESHOLD` | No | 0.05 | Percentage drop to trigger alert (5%) |
| `PRICE_SPIKE_THRESHOLD` | No | 0.10 | Percentage increase to trigger alert (10%) |
| `ALERT_COOLDOWN_MS` | No | 14400000 | Cooldown between alerts for same product (4 hours) |
| `LOG_LEVEL` | No | info | Logging level (debug, info, warn, error) |

### Runtime Configuration

The following can be configured at runtime via `/config`:

| Setting | Command | Description |
|---------|---------|-------------|
| Per-alert channels | `/config channel` | Route alerts to specific channels |
| Alert toggles | `/config toggle` | Enable/disable alert types |
| Price thresholds | `/config threshold` | Adjust price change thresholds |
| Poll interval | `/config interval` | How often to check (requires restart) |
| Alert cooldown | `/config cooldown` | Time between duplicate alerts |

## Commands

### `/status`
Shows bot status including:
- Last check time
- Number of products being monitored
- Next scheduled check

### `/deals`
Lists current best $/TB deals with optional filters:
- `--type HDD|SSD` - Filter by drive type
- `--min-tb N` - Minimum capacity in TB

### `/history <sku>`
Shows price history for a specific product SKU.

### `/config` (Admin Only)
Configure the bot at runtime. All settings persist across restarts.

**Subcommands:**
- `/config show` - Display current configuration
- `/config channel <alert_type> [channel]` - Set channel for specific alert type (leave empty for default)
- `/config toggle <alert_type> <enabled>` - Enable/disable an alert type
- `/config threshold <type> [percent]` - Set price change threshold (leave empty to reset)
- `/config interval [seconds]` - Set polling interval (requires restart)
- `/config cooldown [minutes]` - Set alert cooldown duration
- `/config reset` - Reset all settings to .env defaults

**Examples:**
```
/config channel new_product #new-drives
/config toggle price_spike false
/config threshold price_drop 10
/config cooldown 60
```

### `/alert`
Manage personal SKU price alert subscriptions.

**Subcommands:**
- `/alert add <sku> <delivery> [channel]` - Subscribe to alerts for a SKU
  - `delivery`: "Direct Message" or "In Channel"
  - `channel`: Required if delivery is "In Channel"
- `/alert remove <sku>` - Unsubscribe from a SKU
- `/alert list` - View your active subscriptions

**Examples:**
```
/alert add ST8000DM004 dm
/alert add WD80EFAX channel #drive-alerts
/alert remove ST8000DM004
/alert list
```

### @Bot Mention Commands
You can also manage subscriptions by mentioning the bot:

```
@OnlyDrives subscribe ST8000DM004
@OnlyDrives subscribe ST8000DM004 channel
@OnlyDrives unsubscribe ST8000DM004
@OnlyDrives list
@OnlyDrives help
```

Or send the bot a DM with commands (no @mention needed).

## Alert Types

| Alert | Color | Trigger |
|-------|-------|---------|
| Price Drop | Green | Price decreases by configured threshold |
| Price Spike | Red | Price increases by configured threshold |
| New Product | Blue | Previously unseen product appears |
| Back in Stock | Blue | Product becomes available again |
| SKU Subscription | Green | Price change on a SKU you're subscribed to |

## Managing the Bot

### Docker Compose

```bash
# Start
docker compose up -d

# Stop
docker compose down

# View logs
docker compose logs -f

# Rebuild after code changes
docker compose build
docker compose up -d

# Restart
docker compose restart
```

### Direct Node.js

For production, consider using a process manager like PM2:

```bash
npm install -g pm2
pm2 start dist/index.js --name onlydrives-bot
pm2 logs onlydrives-bot
pm2 restart onlydrives-bot
```

## Data Storage

The bot uses SQLite for minimal state storage:
- **Docker**: Data persists in a named volume `bot-data`
- **Local**: Data stored in `./data/bot.db`

The database stores:
- Last known prices for change detection
- Alert deduplication logs
- Runtime configuration (from `/config` commands)
- User SKU subscriptions (from `/alert` commands)
- Initial sync flag (prevents alert spam on first run)

Full price history is fetched from the OnlyDrives API when needed.

## Troubleshooting

### "TokenInvalid" Error
- Verify your `DISCORD_TOKEN` is correct
- If the token was exposed, reset it in the Developer Portal

### Commands Not Showing
- Run `npm run deploy-commands` (or via Docker Compose)
- Guild commands appear instantly; global commands take up to 1 hour
- Ensure the bot has `applications.commands` scope

### Bot Not Sending Alerts
- Verify `ALERT_CHANNEL_ID` is correct
- Ensure bot has `Send Messages` and `Embed Links` permissions in that channel
- If using per-alert channels via `/config channel`, ensure the bot has permissions in **all** configured channels
- Check logs for errors

### Database Errors
- For Docker: Check volume permissions
- For local: Ensure `./data` directory exists with write permissions

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type checking
npm run lint

# Development with auto-reload
npm run dev
```

## License

MIT
