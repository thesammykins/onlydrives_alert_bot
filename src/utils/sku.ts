const SKU_PATTERN = /^[A-Z0-9-]{3,40}$/;

export interface ParsedSkuList {
  valid: string[];
  invalid: string[];
}

export function parseSkuList(input: string): ParsedSkuList {
  const candidates = input
    .split(/[\s,]+/)
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => value.toUpperCase());

  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const sku of candidates) {
    if (seen.has(sku)) continue;
    seen.add(sku);

    if (SKU_PATTERN.test(sku)) {
      valid.push(sku);
    } else {
      invalid.push(sku);
    }
  }

  return { valid, invalid };
}

export function formatSkuList(input: string[]): string {
  return input.map(sku => `**${sku}**`).join(', ');
}
