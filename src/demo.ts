#!/usr/bin/env node
import path from 'path';

async function main(): Promise<void> {
  process.env.OSKI_MOCK = 'true';
  process.env.OSKI_WORKSPACE_ROOTS = path.join(process.cwd(), 'examples', 'workspace');
  process.env.OSKI_LIVE_TOOLS = '';

  const [{ initRegistry }, { enqueue }, { processNextTask }, { getLastTask }] = await Promise.all([
    import('./tool-registry'),
    import('./queue'),
    import('./runner'),
    import('./state'),
  ]);

  console.log('[oski:demo] Starting credential-free demo.');
  initRegistry();
  const task = enqueue('Read TODO.md, summarize the open work, and draft a team update.', 'manual');
  console.log(`[oski:demo] Queued task ${task.id.slice(0, 8)} through the real FIFO queue.`);
  await processNextTask();

  const result = getLastTask();
  if (!result?.success) throw new Error(result?.reply ?? 'Demo task did not complete.');
  console.log(`\n[oski:demo] Agent response:\n${result.reply}`);
  console.log('\n[oski:demo] Complete. No API key or Slack credentials were used.');
}

main().catch(err => {
  console.error('[oski:demo] failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
