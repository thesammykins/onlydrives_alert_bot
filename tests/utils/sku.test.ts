import { describe, it, expect } from 'vitest';
import { formatSkuList, parseSkuList } from '../../src/utils/sku.js';

describe('sku utils', () => {
  it('parses valid and invalid SKU list', () => {
    const { valid, invalid } = parseSkuList('ST8000DM004, bad_sku, WD80EFAX');

    expect(valid).toEqual(['ST8000DM004', 'WD80EFAX']);
    expect(invalid).toEqual(['BAD_SKU']);
  });

  it('deduplicates SKUs and uppercases values', () => {
    const { valid, invalid } = parseSkuList('wd80efax WD80EFAX');

    expect(valid).toEqual(['WD80EFAX']);
    expect(invalid).toEqual([]);
  });

  it('formats SKU list for display', () => {
    expect(formatSkuList(['ST8000DM004', 'WD80EFAX'])).toBe('**ST8000DM004**, **WD80EFAX**');
  });
});
