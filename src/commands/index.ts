import type { Command } from '../bot.js';
import type { Database } from '../services/database.js';
import { createStatusCommand } from './status.js';
import { createDealsCommand } from './deals.js';
import { createHistoryCommand } from './history.js';
import { createConfigCommand } from './config.js';

export function loadCommands(db: Database): Command[] {
  return [
    createStatusCommand(db),
    createDealsCommand(),
    createHistoryCommand(),
    createConfigCommand(db),
  ];
}
