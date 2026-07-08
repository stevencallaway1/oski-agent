import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import { dequeue, queueLength, recordFailure, type AgentTask } from './queue';
import { buildSystemPrompt, buildUserMessage } from './context';
import { toAnthropicTools, getTool } from './tool-registry';
import { logCost, estimateUsd, todaySpendUsd } from './cost-log';
import { POLICY } from './policy';
import { log } from './logger';
import { setLastTask, setProcessing, incrementPolicyViolations } from './state';

const TASK_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;

let running = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  taskId: string,
  maxRetries = MAX_RETRIES
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = msg.includes('rate_limit') || msg.includes('529') || msg.includes('overloaded');
      const isRetryable = isRateLimit || msg.includes('connection') || msg.includes('ETIMEDOUT');

      if (!isRetryable || attempt === maxRetries) break;
      const delay = isRateLimit ? 30_000 : Math.pow(2, attempt) * 1_000;
      log.retry(taskId, attempt, msg.slice(0, 80));
      await sleep(delay);
    }
  }
  throw lastErr;
}

function withTimeout<T>(fn: () => Promise<T>, ms: number, taskId: string): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        log.timeout(taskId, ms);
        reject(new Error(`Task timed out after ${ms}ms`));
      }, ms)
    ),
  ]);
}

async function fetchThreadHistory(channel: string, messageTs: string): Promise<string> {
  const token = process.env.OSKI_SLACK_BOT_TOKEN;
  if (!token) return '';
  const { WebClient } = await import('@slack/web-api');
  const client = new WebClient(token);

  // Look up the triggering message to find its thread_ts. This works regardless of
  // whether the Socket Mode SDK surfaced event.thread_ts (SDK versions vary on this).
  const histResult = await client.conversations.history({
    channel,
    latest: messageTs,
    limit: 1,
    inclusive: true,
  });
  const currentMsg = histResult.messages?.[0] as { thread_ts?: string; ts?: string } | undefined;
  const threadTs = currentMsg?.thread_ts;

  // Not a thread reply, or is the root message itself.
  if (!threadTs || threadTs === messageTs) return '';

  const result = await client.conversations.replies({ channel, ts: threadTs, limit: 20 });
  // Slice off the last message — that's the one we're currently responding to.
  const msgs = (result.messages ?? []).slice(0, -1);
  if (msgs.length === 0) return '';

  const lines = msgs.map(m => {
    const role = (m as { bot_id?: string }).bot_id ? 'Oski' : 'User';
    return `${role}: ${String((m as { text?: string }).text ?? '').substring(0, 500)}`;
  });
  return `[Thread history - earlier messages in this conversation]\n${lines.join('\n')}\n[End of thread history]\n\n`;
}

async function runAgenticLoop(task: AgentTask): Promise<string> {
  const dailySpend = todaySpendUsd();
  if (dailySpend >= POLICY.dailyCapUsd) {
    const msg = `Daily spend cap ($${POLICY.dailyCapUsd}) reached ($${dailySpend.toFixed(4)} spent today). Queue paused until midnight UTC.`;
    log.policyBlock(msg);
    incrementPolicyViolations();
    return msg;
  }

  // Always attempt to load thread history using the message ts directly.
  // fetchThreadHistory detects internally whether this is a thread reply.
  let historyPrefix = '';
  if (task.payload.channel && task.payload.slackTs) {
    historyPrefix = await fetchThreadHistory(task.payload.channel, task.payload.slackTs).catch(err => {
      console.error('[oski:runner] thread history fetch failed:', err instanceof Error ? err.message : String(err));
      return '';
    });
    if (historyPrefix) {
      console.log(`[oski:runner] loaded thread history for ${task.payload.slackTs}`);
    }
  }

  const client = new Anthropic({ apiKey: getApiKey() });
  const messages: MessageParam[] = [{ role: 'user', content: historyPrefix + buildUserMessage(task) }];
  const tools = toAnthropicTools();
  const toolCallNames: string[] = [];

  let totalInput = 0;
  let totalOutput = 0;
  let finalText = '';
  let model = POLICY.defaultModel;
  const startMs = Date.now();

  for (let step = 0; step < 10; step++) {
    const response = await withRetry(
      () => client.messages.create({
        model,
        max_tokens: POLICY.maxOutputTokens,
        system: buildSystemPrompt(),
        tools: tools.length > 0 ? tools : undefined,
        messages,
      }),
      task.id
    );

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    if (response.stop_reason === 'end_turn') {
      finalText = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('\n');
      break;
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: MessageParam['content'] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const tb = block as ToolUseBlock;
        toolCallNames.push(tb.name);

        const tool = getTool(tb.name);
        let result: unknown;
        if (!tool) {
          result = { error: `Unknown tool: ${tb.name}.` };
        } else {
          try {
            result = await tool.run(tb.input as Record<string, unknown>);
          } catch (err) {
            result = { error: err instanceof Error ? err.message : String(err) };
          }
        }

        log.toolCall(task.id, tb.name, JSON.stringify(result));
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tb.id,
          content: JSON.stringify(result),
        });

        if (step >= 2 && model === POLICY.defaultModel) {
          model = POLICY.reasoningModel;
          console.log(`[oski:runner] escalating to ${model} at step ${step}`);
        }
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    finalText = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('\n');
    break;
  }

  const durationMs = Date.now() - startMs;
  const usd = estimateUsd(model, totalInput, totalOutput);
  logCost({
    ts: new Date().toISOString(),
    taskId: task.id,
    model,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    usd,
    toolCalls: toolCallNames,
  });
  log.taskDone(task.id, durationMs, usd);

  return finalText.trim() || '(no text response)';
}

// postToSlack is set by socket-mode.ts so the runner can reply without a circular dep.
let _postToSlack: ((channel: string, text: string, threadTs?: string) => Promise<void>) | null = null;

export function registerSlackPoster(fn: (channel: string, text: string, threadTs?: string) => Promise<void>): void {
  _postToSlack = fn;
}

export async function processNextTask(): Promise<void> {
  const task = dequeue();
  if (!task) return;

  const startedAt = new Date().toISOString();
  setProcessing(true);
  log.taskStart(task.id, task.payload.text);

  try {
    const reply = await withTimeout(
      () => runAgenticLoop(task),
      TASK_TIMEOUT_MS,
      task.id
    );

    setLastTask({
      id: task.id,
      text: task.payload.text,
      source: task.source,
      startedAt,
      completedAt: new Date().toISOString(),
      success: true,
      reply,
      durationMs: Date.now() - new Date(startedAt).getTime(),
    });

    if (task.source === 'slack' && task.payload.channel && _postToSlack) {
      // Thread continuations reply in the original thread (threadTs).
      // Top-level messages start a thread under the user's own message (slackTs).
      const replyThreadTs = task.payload.threadTs ?? task.payload.slackTs;
      await _postToSlack(task.payload.channel, reply, replyThreadTs);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.taskFailed(task.id, error);
    recordFailure(task, error);

    setLastTask({
      id: task.id,
      text: task.payload.text,
      source: task.source,
      startedAt,
      completedAt: new Date().toISOString(),
      success: false,
      reply: `Error: ${error}`,
      durationMs: Date.now() - new Date(startedAt).getTime(),
    });

    if (task.source === 'slack' && task.payload.channel && _postToSlack) {
      const replyThreadTs = task.payload.threadTs ?? task.payload.slackTs;
      await _postToSlack(
        task.payload.channel,
        `Task failed: ${error.slice(0, 200)}`,
        replyThreadTs
      );
    }
  } finally {
    setProcessing(false);
  }
}

export function startRunner(): void {
  if (running) return;
  running = true;
  console.log('[oski:runner] started. Polling every 5s.');

  intervalHandle = setInterval(async () => {
    if (queueLength() === 0) return;
    await processNextTask();
  }, 5_000);
}

export function stopRunner(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  running = false;
  console.log('[oski:runner] stopped.');
}
