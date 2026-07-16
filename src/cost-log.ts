import fs from 'fs';
import { COST_LOG } from './paths';

export interface CostEntry {
  ts: string;
  taskId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  toolCalls: string[];
}

// Pricing per million tokens (input / output), keyed by model prefix.
// Edit this table to match current Anthropic pricing for the models you use.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-opus': { input: 15.0, output: 75.0 },
};

// Unknown models fall back to the most expensive known tier so the daily cap
// errs on the side of pausing early rather than overspending.
const FALLBACK = PRICING['claude-opus'];

export function estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(PRICING).find(k => model.startsWith(k));
  const p = key ? PRICING[key] : FALLBACK;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function logCost(entry: CostEntry): void {
  try {
    fs.appendFileSync(COST_LOG, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // non-fatal
  }
  const usd = entry.usd.toFixed(4);
  console.log(`[oski:cost] task=${entry.taskId} model=${entry.model} in=${entry.inputTokens} out=${entry.outputTokens} usd=$${usd}`);
}

export function todaySpendUsd(): number {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const lines = fs.readFileSync(COST_LOG, 'utf8').trim().split('\n').filter(Boolean);
    return lines.reduce((sum, line) => {
      try {
        const e = JSON.parse(line) as CostEntry;
        if (e.ts.startsWith(today)) return sum + e.usd;
      } catch { /* skip */ }
      return sum;
    }, 0);
  } catch {
    return 0;
  }
}

export function weekSpendUsd(): number {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const lines = fs.readFileSync(COST_LOG, 'utf8').trim().split('\n').filter(Boolean);
    return lines.reduce((sum, line) => {
      try {
        const e = JSON.parse(line) as CostEntry;
        if (e.ts >= cutoff) return sum + e.usd;
      } catch { /* skip */ }
      return sum;
    }, 0);
  } catch {
    return 0;
  }
}
