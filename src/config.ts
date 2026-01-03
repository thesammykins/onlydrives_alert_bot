import { z } from 'zod';
import type { Config } from './types.js';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  ALERT_CHANNEL_ID: z.string().min(1),
  POLL_INTERVAL_MS: z.string().transform(Number).default('300000'),
  PRICE_DROP_THRESHOLD: z.string().transform(Number).default('0.05'),
  PRICE_SPIKE_THRESHOLD: z.string().transform(Number).default('0.10'),
  ALERT_COOLDOWN_MS: z.string().transform(Number).default('14400000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export function loadConfig(): Config {
  const env = envSchema.parse(process.env);

  return {
    discord: {
      token: env.DISCORD_TOKEN,
      clientId: env.DISCORD_CLIENT_ID,
      guildId: env.DISCORD_GUILD_ID,
      alertChannelId: env.ALERT_CHANNEL_ID,
    },
    monitoring: {
      pollIntervalMs: env.POLL_INTERVAL_MS,
      priceDropThreshold: env.PRICE_DROP_THRESHOLD,
      priceSpikeThreshold: env.PRICE_SPIKE_THRESHOLD,
      alertCooldownMs: env.ALERT_COOLDOWN_MS,
    },
    logLevel: env.LOG_LEVEL,
  };
}
