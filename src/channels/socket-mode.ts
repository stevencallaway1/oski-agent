import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import cron from 'node-cron';
import { enqueue, queueLength } from '../queue';
import { parseOskiCommand } from '../command-parser';
import { log } from '../logger';
import { registerSlackPoster } from '../runner';
import { listTools } from '../tool-registry';
import { todaySpendUsd, weekSpendUsd } from '../cost-log';
import { getLastTask, getRecentFailures, getPolicyViolationCount, getProcessing } from '../state';
import { POLICY } from '../policy';
import { approvePendingDraft } from '../approvals';

// Read at call-time (inside startSocketMode) so dotenv has already run.
function getAppToken(): string { return process.env.OSKI_SLACK_APP_TOKEN ?? ''; }
function getBotToken(): string { return process.env.OSKI_SLACK_BOT_TOKEN ?? ''; }
function getOskiChannel(): string { return (process.env.OSKI_SLACK_CHANNEL_ID ?? '').trim(); }

// The web client is used for all Slack API calls (post messages, reactions, etc.)
let webClient: WebClient | null = null;

// Resolved channel ID - set at connect time. OSKI_SLACK_CHANNEL_ID may be a name
// (e.g. "oski" or "#oski") or an ID (e.g. "C0123456789"). Slack's postMessage accepts
// names but event.channel is always an ID, so we resolve once and compare against this.
let resolvedChannelId = '';

async function resolveChannelId(configured: string): Promise<string> {
  if (!configured) return '';
  // Already looks like a channel ID (Cxxxxxxxxx).
  if (/^C[A-Z0-9]{6,}$/i.test(configured)) {
    console.log(`[oski:slack] channel ID confirmed: ${configured}`);
    return configured;
  }
  // It's a name - look it up.
  const name = configured.replace(/^#/, '');
  try {
    const result = await webClient?.conversations.list({ types: 'public_channel,private_channel', limit: 200 });
    const ch = (result?.channels ?? []).find((c: { name?: string; id?: string }) => c.name === name);
    if (ch?.id) {
      console.log(`[oski:slack] resolved channel name "${configured}" → ID "${ch.id}"`);
      return ch.id;
    }
    console.warn(`[oski:slack] could not resolve channel name "${configured}" - no matching channel found`);
  } catch (err) {
    console.warn('[oski:slack] channel resolution failed:', err instanceof Error ? err.message : String(err));
  }
  return configured;
}

export function getWebClient(): WebClient | null {
  return webClient;
}

async function postToChannel(channel: string, text: string, threadTs?: string): Promise<void> {
  if (!webClient) return;
  const destination = resolvedChannelId && channel === getOskiChannel() ? resolvedChannelId : channel;
  log.slackPost(destination, 'live');
  try {
    await webClient.chat.postMessage({
      channel: destination,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
  } catch (err) {
    console.error('[oski:slack] failed to post message:', err instanceof Error ? err.message : err);
    throw err;
  }
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  return formatDuration(diff) + ' ago';
}

async function handleStatusCommand(channel: string, threadTs?: string): Promise<void> {
  const lastTask = getLastTask();
  const tools = listTools();
  const dailySpend = todaySpendUsd();
  const weekSpend = weekSpendUsd();
  const paused = dailySpend >= POLICY.dailyCapUsd;
  const qDepth = queueLength();
  const failures = getRecentFailures();
  const violations = getPolicyViolationCount();
  const processing = getProcessing();

  const lines: string[] = [
    `*Oski Status*`,
    `Queue: ${qDepth} pending${processing ? ' (processing now)' : ''}`,
    `Tools: ${tools.length} loaded`,
    `Daily spend: $${dailySpend.toFixed(4)} / $${POLICY.dailyCapUsd} cap${paused ? ' *[PAUSED]*' : ''}`,
    `Week spend: $${weekSpend.toFixed(4)}`,
    `Policy violations today: ${violations}`,
    `Recent failures: ${failures.length}`,
    lastTask
      ? `Last task: "${lastTask.text.slice(0, 50)}" (${timeAgo(lastTask.completedAt)}, ${lastTask.success ? 'success' : 'failed'})`
      : `Last task: none`,
  ];

  await postToChannel(channel, lines.join('\n'), threadTs);
}

async function handleToolsCommand(channel: string, threadTs?: string): Promise<void> {
  const tools = listTools();
  if (tools.length === 0) {
    await postToChannel(channel, 'No tools loaded yet.', threadTs);
    return;
  }

  const lines = [`*Loaded tools (${tools.length}):*`];
  for (const t of tools) {
    lines.push(`• \`${t.name}\` [${t.scope}] - ${t.description.slice(0, 60)}`);
  }
  await postToChannel(channel, lines.join('\n'), threadTs);
}

async function handleCostCommand(channel: string, threadTs?: string): Promise<void> {
  const today = todaySpendUsd();
  const week = weekSpendUsd();
  const cap = POLICY.dailyCapUsd;
  const paused = today >= cap;

  const lines = [
    `*Oski Cost Report*`,
    `Today: $${today.toFixed(4)} / $${cap} cap${paused ? ' *[CAP HIT - PAUSED]*' : ''}`,
    `This week: $${week.toFixed(4)}`,
    `Default model: ${POLICY.defaultModel}`,
    `Reasoning model: ${POLICY.reasoningModel}`,
    `Full log: \`data/agent/cost.jsonl\``,
  ];
  await postToChannel(channel, lines.join('\n'), threadTs);
}

async function handleHelpCommand(channel: string, threadTs?: string): Promise<void> {
  const tools = listTools();
  const text = [
    `*Oski - Internal Ops Agent*`,
    `I handle internal team operations: status checks, research over approved files, drafting internal updates and replies. All actions are draft-only unless explicitly trusted.`,
    ``,
    `*Commands:*`,
    `• \`oski: <task>\` - run any ops task`,
    `• \`oski learn: <rule>\` - teach me a new behavioral rule`,
    `• \`oski status\` - health check (queue, spend, last task)`,
    `• \`oski tools\` - list all ${tools.length} loaded tools`,
    `• \`oski cost\` - cost breakdown`,
    `• \`oski help\` - this message`,
    ``,
    `*Example tasks:*`,
    `• \`oski: summarize the open items in TODO.md\``,
    `• \`oski: check team status\``,
    `• \`oski: draft an internal update about this week's progress\``,
    `• \`oski: search the workspace for where rate limiting is handled\``,
    ``,
    `All outbound posts start as drafts. Nothing sends to external channels without your approval.`,
  ].join('\n');

  await postToChannel(channel, text, threadTs);
}

function logOnline(): void {
  const tools = listTools();
  console.log(`[oski] online - ${tools.length} tools loaded. All actions are draft-only.`);
}

export async function startSocketMode(): Promise<SocketModeClient | null> {
  const appToken = getAppToken();
  const botToken = getBotToken();

  if (!appToken) {
    console.warn('[oski:slack] OSKI_SLACK_APP_TOKEN not set - Socket Mode disabled. Set it to enable Slack integration.');
    return null;
  }
  if (!botToken) {
    console.warn('[oski:slack] OSKI_SLACK_BOT_TOKEN not set - Socket Mode disabled.');
    return null;
  }

  webClient = new WebClient(botToken);

  // Register the poster with the runner so it can reply without a direct dep on this module.
  registerSlackPoster(postToChannel);

  const socketClient = new SocketModeClient({ appToken });

  socketClient.on('connected', () => {
    log.socketConnect();
    logOnline();
    // Resolve the configured channel to an ID, then verify scopes.
    resolveChannelId(getOskiChannel()).then(id => {
      resolvedChannelId = id;
      console.log(`[oski:slack] listening for plain messages in channel: "${resolvedChannelId}"`);
      return webClient?.conversations.history({ channel: resolvedChannelId, limit: 1 });
    }).then(() => {
      console.log('[oski:slack] channels:history scope confirmed - thread memory will work');
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[oski:slack] scope or channel check failed:', msg);
    });
  });

  // Optional once-daily heartbeat (direct post, no queue/API cost). Off by default.
  if (getOskiChannel() && process.env.OSKI_HEARTBEAT_ENABLED === 'true') {
    cron.schedule('0 16 * * *', async () => {
      if (!resolvedChannelId) return;
      const tools = listTools();
      await postToChannel(resolvedChannelId, `Oski is online. ${tools.length} tools loaded. Type \`oski help\` for commands.`);
    });
  }

  socketClient.on('disconnecting', () => {
    log.socketDisconnect('disconnecting');
  });

  // Handle message events.
  socketClient.on('message', async ({ event, ack }: { event: Record<string, unknown>; ack: () => Promise<void> }) => {
    await ack();

    console.log('[oski:msg]', JSON.stringify({ channel: event.channel, type: event.type, subtype: event.subtype, bot_id: event.bot_id, thread_ts: event.thread_ts, text: String(event.text ?? '').slice(0, 60) }));

    // Ignore bot messages and edits.
    if (event.bot_id || event.subtype) return;

    const rawText = String(event.text ?? '').trim();
    const channel = String(event.channel ?? '');
    const user = String(event.user ?? '');
    const slackTs = String(event.ts ?? '');
    const threadTs = event.thread_ts ? String(event.thread_ts) : undefined;

    if (!rawText || !channel) return;
    if (resolvedChannelId && channel !== resolvedChannelId) return;

    const normalizedText = rawText.toLowerCase();
    if (normalizedText === 'send it' || normalizedText === 'approve') {
      const approval = await approvePendingDraft({
        channel,
        threadTs,
        userId: user,
        isBot: Boolean(event.bot_id),
      }, postToChannel);
      await postToChannel(
        channel,
        approval.approved
          ? `Posted the saved draft. Human approval logged for task \`${approval.taskId?.slice(0, 8)}\`.`
          : approval.reason ?? 'No pending draft was approved.',
        threadTs ?? slackTs
      );
      return;
    }

    // Parse the command. The bot only receives message events from channels it is
    // a member of, and the configured channel is enforced above when present.
    let command = parseOskiCommand(rawText);
    if (!command) {
      command = { type: 'task', text: rawText.trim() };
    }

    log.inbound('slack', user, rawText);
    log.command(command.type, user);

    // Thread to use for ack/reply: existing thread if replying, or start one under the user's message.
    const replyThread = threadTs ?? slackTs;

    // Immediate-response commands - don't go through the queue.
    if (command.type === 'status') {
      await handleStatusCommand(channel, replyThread);
      return;
    }
    if (command.type === 'help') {
      await handleHelpCommand(channel, replyThread);
      return;
    }
    if (command.type === 'tools') {
      await handleToolsCommand(channel, replyThread);
      return;
    }
    if (command.type === 'cost') {
      await handleCostCommand(channel, replyThread);
      return;
    }

    // Queue-backed commands.
    if (command.type === 'task') {
      const task = enqueue(command.text, 'slack', { channel, user, slackTs, threadTs });
      log.enqueue(task.id, 'slack', command.text);
      await postToChannel(channel, `Got it. Working on it... (task \`${task.id.slice(0, 8)}\`)`, replyThread);
      return;
    }

    if (command.type === 'learn') {
      // Enqueue as a task that will call update_instructions.
      const taskText = `Call update_instructions to append the following rule to the appropriate section of instructions.md: "${command.rule}"`;
      const task = enqueue(taskText, 'slack', { channel, user, slackTs, threadTs });
      log.enqueue(task.id, 'slack:learn', command.rule);
      await postToChannel(channel, `Got it. Learning: "${command.rule.slice(0, 80)}"`, replyThread);
      return;
    }
  });

  // Handle app_mention events (when someone @mentions the bot).
  socketClient.on('app_mention', async ({ event, ack }: { event: Record<string, unknown>; ack: () => Promise<void> }) => {
    await ack();

    const rawText = String(event.text ?? '').trim();
    const channel = String(event.channel ?? '');
    const user = String(event.user ?? '');
    const slackTs = String(event.ts ?? '');
    const threadTs = event.thread_ts ? String(event.thread_ts) : undefined;
    const replyThread = threadTs ?? slackTs;
    if (resolvedChannelId && channel !== resolvedChannelId) return;

    const command = parseOskiCommand(rawText);
    if (!command) return;

    log.inbound('slack:mention', user, rawText);

    if (command.type === 'help') {
      await handleHelpCommand(channel, replyThread);
      return;
    }

    if (command.type === 'task') {
      const task = enqueue(command.text, 'slack', { channel, user, slackTs, threadTs });
      await postToChannel(channel, `On it. (task \`${task.id.slice(0, 8)}\`)`, replyThread);
    }
  });

  try {
    await socketClient.start();
    return socketClient;
  } catch (err) {
    console.error('[oski:slack] failed to start Socket Mode:', err instanceof Error ? err.message : err);
    return null;
  }
}
