import 'dotenv/config';
import express from 'express';
import { initRegistry } from './tool-registry';
import { startRunner } from './runner';
import { startAgentCronJobs } from './channels/cron';
import { createSlackEventsRouter } from './channels/slack-events';
import { startSocketMode } from './channels/socket-mode';

async function main(): Promise<void> {
  console.log('[oski] initializing...');

  // Load all tools from builtin/ and generated/.
  initRegistry();

  // Start the task queue runner.
  startRunner();

  // Start recurring cron jobs (opt-in via OSKI_CRON_ENABLED).
  startAgentCronJobs();

  // Prefer Socket Mode for Slack integration (no public URL required).
  // Falls back to the HTTP Events API if only a signing secret is configured.
  const appToken = process.env.OSKI_SLACK_APP_TOKEN;
  const signingSecret = process.env.OSKI_SLACK_SIGNING_SECRET;

  if (appToken) {
    await startSocketMode();
    console.log('[oski] Slack connected via Socket Mode.');
  } else if (signingSecret) {
    const app = express();
    app.use('/slack/events', createSlackEventsRouter());
    const port = parseInt(process.env.PORT ?? '3001', 10);
    app.listen(port, () => {
      console.log(`[oski] Slack connected via HTTP Events API (POST http://localhost:${port}/slack/events).`);
    });
  } else {
    console.log('[oski] No Slack credentials found — running in CLI-only mode.');
    console.log('[oski] Enqueue tasks with: npm run agent:task -- "your task here"');
  }

  console.log('[oski] ready.');
}

main().catch(err => {
  console.error('[oski] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
