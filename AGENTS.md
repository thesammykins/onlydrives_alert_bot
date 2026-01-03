# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-03
**Commit:** c579a59
**Branch:** main

## OVERVIEW

Discord bot monitoring OnlyDrives API for price changes. TypeScript + discord.js + SQLite (better-sqlite3) + Zod. Polls products, detects price drops/spikes/new/restock, sends Discord alerts.

## STRUCTURE

```
onlydrives_alert_bot/
├── src/
│   ├── commands/       # Slash command handlers (/status, /deals, /history)
│   ├── monitors/       # Background polling orchestrator (non-standard: not event-driven)
│   ├── services/       # API client, database, alerter, price-monitor
│   ├── scripts/        # init-db.ts
│   ├── utils/          # Embed builders
│   ├── index.ts        # Entry: config → db → client → monitors
│   ├── bot.ts          # Discord client factory + interaction handler
│   ├── config.ts       # Zod-validated env vars
│   ├── types.ts        # Shared interfaces
│   └── deploy-commands.ts
├── tests/
│   ├── services/       # Unit tests mirror src/services/
│   └── fixtures/       # JSON API response samples
├── Dockerfile          # Multi-stage alpine build
└── docker-compose.yml  # Production deployment
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add slash command | `src/commands/` | Create file, add to `index.ts` loader manually |
| Change alert thresholds | `src/config.ts` | Zod schema with defaults |
| Modify price detection | `src/services/price-monitor.ts` | Core business logic |
| Add new alert type | `src/types.ts` (AlertType), `src/services/alerter.ts` | |
| Database schema | `src/services/database.ts` | Schema in constructor |
| API endpoints | `src/services/api.ts` | BASE_URL hardcoded (tech debt) |
| Discord embeds | `src/utils/embed.ts` | |
| Test patterns | `tests/services/` | Factory functions, :memory: SQLite |

## CONVENTIONS

### ESM Import Extensions (CRITICAL)
All local imports MUST use `.js` extension:
```typescript
// CORRECT
import { loadConfig } from './config.js';

// WRONG - will fail at runtime
import { loadConfig } from './config';
```

### Command Registration
Manual loader pattern (not dynamic fs scan):
```typescript
// src/commands/index.ts - add new commands here explicitly
export function loadCommands(db: Database): Command[] {
  return [
    createStatusCommand(db),
    createDealsCommand(),
    createHistoryCommand(),
    // Add new commands here
  ];
}
```

### Configuration
All env vars validated via Zod in `src/config.ts`. Add new vars there with defaults.

### Database
- Use `:memory:` for tests
- Schema defined in `Database` constructor
- Sync API (better-sqlite3)

### Testing
- Vitest with globals enabled
- Factory functions over static fixtures: `createProduct()`, `createState()`
- No Discord.js mocking yet (alerter untested)
- API tests hit real endpoint (no MSW)

## ANTI-PATTERNS (THIS PROJECT)

| Don't | Why |
|-------|-----|
| Dynamic command loading | Project uses explicit loader for type safety |
| Store price history locally | API provides `/price-history` endpoint |
| Use ESM imports without `.js` | Runtime breaks |
| Add privileged intents | Not needed, keep minimal |

## TECH DEBT

| Issue | Location | Severity |
|-------|----------|----------|
| Hardcoded API URL | `src/services/api.ts:3` | Low |
| Console logging (no structured logger) | Throughout | Medium |
| No alerter tests | `src/services/alerter.ts` | Medium |
| API tests hit live endpoint | `tests/services/api.test.ts` | Low |

## COMMANDS

```bash
# Development
npm run dev              # tsx watch mode
npm run lint             # tsc --noEmit

# Testing
npm test                 # vitest run
npm run test:watch       # vitest
npm run test:coverage    # with coverage

# Build & Deploy
npm run build            # tsup → dist/
npm run db:init          # Initialize SQLite
npm run deploy-commands  # Register Discord commands
npm start                # Production run

# Docker
docker compose build
docker compose up -d
docker compose logs -f
```

## NOTES

- **First run requires**: `npm run db:init` then `npm run deploy-commands`
- **Data location**: `./data/bot.db` (Docker: `bot-data` volume)
- **SPEC.md**: Authoritative spec for alert logic, thresholds, schema
- **Minimal intents**: Only `GatewayIntentBits.Guilds` needed
- **Monitor pattern**: Uses polling orchestrator, not Discord events
