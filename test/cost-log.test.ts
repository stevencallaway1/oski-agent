import { describe, expect, it } from 'vitest';
import { estimateUsd } from '../src/cost-log';

describe('cost estimates', () => {
  it('uses current Claude Haiku 4.5 standard pricing', () => {
    expect(estimateUsd('claude-haiku-4-5-20251001', 1_000_000, 1_000_000)).toBe(6);
  });

  it('prices unknown models at the conservative fallback tier', () => {
    expect(estimateUsd('unknown-model', 1_000_000, 1_000_000)).toBe(90);
  });
});
