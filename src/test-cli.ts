#!/usr/bin/env node
// Local test utilities for Oski. No Slack connection required.
// Usage:
//   npm run agent:mock -- "oski: summarize the workspace README"   mock a Slack event
//   npm run agent:queue                                            inspect queue
//   npm run agent:failures                                         show recent failures

import 'dotenv/config';
import { initRegistry } from './tool-registry';
import { enqueue, peekQueue, getFailedTasks } from './queue';
import { processNextTask } from './runner';
import { parseOskiCommand } from './command-parser';
import { todaySpendUsd, weekSpendUsd } from './cost-log';
import { getLastTask, getRecentFailures } from './state';

const subcommand = process.argv[2] ?? 'mock';
const arg = process.argv.slice(3).join(' ').trim();

void (async () => {
  initRegistry();

  switch (subcommand) {
    case 'mock': {
      const text = arg || 'oski: list your loaded tools';
      const command = parseOskiCommand(text);
      if (!command || command.type === 'status' || command.type === 'help') {
        console.log(`[test] Parsed command: ${JSON.stringify(command)}`);
        console.log('[test] Use "oski: <task>" for queue-backed tasks.');
        process.exit(0);
      }

      const taskText = command.type === 'task' ? command.text
        : command.type === 'learn' ? `Call update_instructions to append: "${command.rule}"`
        : text;

      console.log(`[test] Mocking Slack event: ${taskText}`);
      enqueue(taskText, 'manual', { channel: 'mock-channel', user: 'operator' });
      await processNextTask();
      const last = getLastTask();
      if (last) {
        console.log('\n[test] Reply:\n', last.reply);
        console.log(`[test] Duration: ${last.durationMs}ms, Success: ${last.success}`);
      }
      break;
    }

    case 'queue': {
      const tasks = peekQueue();
      if (tasks.length === 0) {
        console.log('[test] Queue is empty.');
      } else {
        console.log(`[test] Queue depth: ${tasks.length}`);
        for (const t of tasks) {
          console.log(`  ${t.id.slice(0, 8)} [${t.source}] ${t.enqueuedAt}: ${t.payload.text.slice(0, 80)}`);
        }
      }
      const failures = getFailedTasks();
      if (failures.length > 0) {
        console.log(`\n[test] Recent failures (${failures.length}):`);
        for (const f of failures.slice(0, 5)) {
          console.log(`  ${f.task.id.slice(0, 8)} ${f.failedAt}: ${f.error.slice(0, 80)}`);
        }
      }
      const today = todaySpendUsd();
      const week = weekSpendUsd();
      console.log(`\n[test] Spend — today: $${today.toFixed(4)}, week: $${week.toFixed(4)}`);
      break;
    }

    case 'failures': {
      const failures = getRecentFailures();
      if (failures.length === 0) {
        console.log('[test] No recent failures.');
      } else {
        console.log(`[test] Recent failures (${failures.length}):`);
        for (const f of failures) {
          console.log(`  ${f.id.slice(0, 8)} [${f.source}] ${f.completedAt}`);
          console.log(`    Task: ${f.text.slice(0, 80)}`);
          console.log(`    Error: ${f.reply.slice(0, 120)}`);
        }
      }
      break;
    }

    default:
      console.log(`[test] Unknown subcommand: ${subcommand}`);
      console.log('Available: mock, queue, failures');
      process.exit(1);
  }

  process.exit(0);
})();
