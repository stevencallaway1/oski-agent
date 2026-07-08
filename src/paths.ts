import fs from 'fs';
import path from 'path';

// All runtime data (queue log, cost log, instruction edit log) lives here.
// The directory is created on first import so append-only logs never fail silently.
export const DATA_DIR = path.join(process.cwd(), 'data', 'agent');

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  // If this fails (read-only fs), logging degrades gracefully elsewhere.
}

export const QUEUE_LOG = path.join(DATA_DIR, 'queue.jsonl');
export const COST_LOG = path.join(DATA_DIR, 'cost.jsonl');
export const EDIT_LOG = path.join(DATA_DIR, 'instruction-edits.jsonl');

// Behavioral instructions live at the project root so they are easy to find and edit.
export const INSTRUCTIONS_PATH = path.join(process.cwd(), 'instructions.md');
