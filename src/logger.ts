// Structured logger for the Oski agent.
// Emits to console with consistent prefixes for easy log filtering.

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEvent {
  level: LogLevel;
  tag: string;
  message: string;
  data?: Record<string, unknown>;
}

function emit(event: LogEvent): void {
  const ts = new Date().toISOString();
  const prefix = `[oski:${event.tag}]`;
  const line = `${prefix} ${event.message}`;

  if (event.level === 'error') {
    console.error(ts, line, event.data ?? '');
  } else if (event.level === 'warn') {
    console.warn(ts, line, event.data ?? '');
  } else {
    console.log(ts, line, event.data ? JSON.stringify(event.data).slice(0, 200) : '');
  }
}

export const log = {
  inbound: (source: string, user: string, text: string) =>
    emit({ level: 'info', tag: 'inbound', message: `${source} from ${user}: ${text.slice(0, 80)}` }),

  enqueue: (taskId: string, source: string, text: string) =>
    emit({ level: 'info', tag: 'queue', message: `enqueued ${taskId} (${source}): ${text.slice(0, 60)}` }),

  taskStart: (taskId: string, text: string) =>
    emit({ level: 'info', tag: 'runner', message: `start ${taskId}: ${text.slice(0, 60)}` }),

  toolCall: (taskId: string, toolName: string, result: string) =>
    emit({ level: 'info', tag: 'tool', message: `${taskId} → ${toolName}: ${result.slice(0, 120)}` }),

  taskDone: (taskId: string, durationMs: number, usd: number) =>
    emit({ level: 'info', tag: 'runner', message: `done ${taskId} in ${durationMs}ms ($${usd.toFixed(4)})` }),

  taskFailed: (taskId: string, error: string) =>
    emit({ level: 'error', tag: 'runner', message: `failed ${taskId}: ${error.slice(0, 200)}` }),

  retry: (taskId: string, attempt: number, reason: string) =>
    emit({ level: 'warn', tag: 'runner', message: `retry ${attempt} for ${taskId}: ${reason}` }),

  timeout: (taskId: string, ms: number) =>
    emit({ level: 'warn', tag: 'runner', message: `timeout ${taskId} after ${ms}ms` }),

  policyBlock: (reason: string) =>
    emit({ level: 'warn', tag: 'policy', message: `blocked: ${reason}` }),

  socketConnect: () =>
    emit({ level: 'info', tag: 'slack', message: 'Socket Mode connected to Slack' }),

  socketDisconnect: (reason: string) =>
    emit({ level: 'warn', tag: 'slack', message: `Socket Mode disconnected: ${reason}` }),

  slackPost: (channel: string, mode: string) =>
    emit({ level: 'info', tag: 'slack', message: `post to ${channel} (${mode})` }),

  command: (command: string, user: string) =>
    emit({ level: 'info', tag: 'command', message: `${command} from ${user}` }),
};
