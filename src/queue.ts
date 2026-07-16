import fs from 'fs';
import { randomUUID } from 'crypto';
import { QUEUE_LOG } from './paths';

export type TaskSource = 'slack' | 'cron' | 'manual';

export interface AgentTask {
  id: string;
  source: TaskSource;
  payload: {
    channel?: string;
    user?: string;
    slackTs?: string;
    threadTs?: string;
    text: string;
  };
  enqueuedAt: string;
}

const queue: AgentTask[] = [];
const failed: Array<{ task: AgentTask; error: string; failedAt: string }> = [];

function appendLog(entry: Record<string, unknown>): void {
  try {
    fs.appendFileSync(QUEUE_LOG, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // non-fatal - in-memory queue is authoritative
  }
}

export function enqueue(
  text: string,
  source: TaskSource,
  meta?: { channel?: string; user?: string; slackTs?: string; threadTs?: string }
): AgentTask {
  const task: AgentTask = {
    id: randomUUID(),
    source,
    payload: { text, ...meta },
    enqueuedAt: new Date().toISOString(),
  };
  queue.push(task);
  appendLog({ event: 'enqueue', ...task });
  return task;
}

export function dequeue(): AgentTask | undefined {
  return queue.shift();
}

export function queueLength(): number {
  return queue.length;
}

export function peekQueue(): AgentTask[] {
  return [...queue];
}

export function recordFailure(task: AgentTask, error: string): void {
  const record = { task, error, failedAt: new Date().toISOString() };
  failed.unshift(record);
  if (failed.length > 20) failed.pop();
  appendLog({ event: 'failure', taskId: task.id, error, failedAt: record.failedAt });
}

export function getFailedTasks(): Array<{ task: AgentTask; error: string; failedAt: string }> {
  return [...failed];
}

export function failedCount(): number {
  return failed.length;
}
