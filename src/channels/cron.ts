import cron from 'node-cron';
import { enqueue } from '../queue';

// Recurring agent tasks fired by cron. Opt-in via OSKI_CRON_ENABLED=true.
// All times are UTC. Edit the schedules and task text to fit your team.

export function startAgentCronJobs(): void {
  if (process.env.OSKI_CRON_ENABLED !== 'true') {
    console.log('[oski:cron] disabled (set OSKI_CRON_ENABLED=true to enable example jobs)');
    return;
  }

  const channel = process.env.OSKI_SLACK_CHANNEL_ID;

  // Weekday morning: team status summary.
  cron.schedule('30 15 * * 1-5', () => {
    enqueue(
      'Check the configured workspace for notes or TODO files updated in the last 24 hours. Summarize the top open item and draft a one-line status update for the team channel.',
      'cron',
      { channel }
    );
  });

  // Weekday midday: open items check.
  cron.schedule('0 18 * * 1-5', () => {
    enqueue(
      'Review the configured workspace for open action items. Draft a one-line summary of anything that looks blocked or overdue.',
      'cron',
      { channel }
    );
  });

  console.log('[oski:cron] example jobs scheduled (15:30 UTC and 18:00 UTC, weekdays)');
}
