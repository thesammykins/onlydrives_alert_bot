import type { Command } from '../bot.js';
import type { Config } from '../types.js';
import type { Database } from '../services/database.js';
import { createStatusCommand } from './status.js';
import { createDealsCommand } from './deals.js';
import { createHistoryCommand } from './history.js';
import { createConfigCommand } from './config.js';
import { createAlertCommand } from './alert.js';
import { createSummaryCommand } from './summary.js';

export function loadCommands(db: Database, config?: Config): Command[] {
  return [
    createStatusCommand(db),
    createDealsCommand(db),
    createHistoryCommand(),
    createConfigCommand(db),
    createAlertCommand(db),
    createSummaryCommand(db, { testGuildId: config?.discord.summaryTestGuildId }),
  ];
}
