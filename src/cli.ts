#!/usr/bin/env node
// Manual task enqueuer for local testing.
// Usage: npm run agent:task -- "your task text here"
//        npm run agent:task  (reads from stdin if no arg)

import 'dotenv/config';
import readline from 'readline';
import { enqueue } from './queue';
import { initRegistry } from './tool-registry';
import { processNextTask } from './runner';

async function main(): Promise<void> {
  initRegistry();

  let text = process.argv.slice(2).join(' ').trim();

  if (!text) {
    const rl = readline.createInterface({ input: process.stdin });
    const lines: string[] = [];
    for await (const line of rl) lines.push(line);
    text = lines.join('\n').trim();
  }

  if (!text) {
    console.error('Usage: npm run agent:task -- "task text"');
    process.exit(1);
  }

  console.log(`[oski:cli] Enqueuing task: ${text.slice(0, 80)}`);
  enqueue(text, 'manual');
  await processNextTask();
}

main().catch(err => {
  console.error('[oski:cli] error:', err);
  process.exit(1);
});
