import { describe, expect, it } from 'vitest';
import { isSummaryDue } from '../../src/services/summary-scheduler.js';
import type { EnabledSummarySettings } from '../../src/types.js';

function createSettings(overrides: Partial<EnabledSummarySettings> = {}): EnabledSummarySettings {
  return {
    guildId: 'guild-1',
    summaryEnabled: true,
    frequency: 'daily',
    channelId: 'summary-channel',
    time: '09:00',
    timezone: 'Etc/UTC',
    layout: 'compact',
    ...overrides,
  };
}

describe('summary scheduler', () => {
  it('runs daily summaries at the configured local time', () => {
    expect(isSummaryDue(createSettings(), new Date('2026-05-01T09:00:00.000Z'))).toBe(true);
    expect(isSummaryDue(createSettings(), new Date('2026-05-01T09:01:00.000Z'))).toBe(false);
  });

  it('runs weekly summaries only on Monday', () => {
    const settings = createSettings({ frequency: 'weekly' });

    expect(isSummaryDue(settings, new Date('2026-05-04T09:00:00.000Z'))).toBe(true);
    expect(isSummaryDue(settings, new Date('2026-05-05T09:00:00.000Z'))).toBe(false);
  });

  it('runs monthly summaries only on the first day of the month', () => {
    const settings = createSettings({ frequency: 'monthly' });

    expect(isSummaryDue(settings, new Date('2026-05-01T09:00:00.000Z'))).toBe(true);
    expect(isSummaryDue(settings, new Date('2026-05-02T09:00:00.000Z'))).toBe(false);
  });
});
