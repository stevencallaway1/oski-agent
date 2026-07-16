import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dequeue, enqueue, queueLength } from '../src/queue';
import { processNextTask, registerSlackPoster, type ModelClient } from '../src/runner';
import { setProcessing } from '../src/state';
import { getPendingDraft } from '../src/approvals';
import { registerTool } from '../src/tool-registry';
import slackDraftTool from '../src/tools/builtin/slack_post_draft';

function drainQueue(): void {
  while (dequeue()) { /* drain shared in-memory state */ }
}

function textResponse(text: string) {
  return {
    stop_reason: 'end_turn' as const,
    content: [{ type: 'text' as const, text }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

describe('runner promises', () => {
  beforeEach(() => {
    drainQueue();
    setProcessing(false);
    registerSlackPoster(async () => {});
    vi.stubEnv('OSKI_DAILY_USD_CAP', '999');
  });

  it('processes at most one queued task at a time', async () => {
    let active = 0;
    let maxActive = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    let calls = 0;
    const client: ModelClient = {
      messages: {
        create: vi.fn(async () => {
          calls++;
          active++;
          maxActive = Math.max(maxActive, active);
          if (calls === 1) await firstGate;
          active--;
          return textResponse(`reply ${calls}`);
        }),
      },
    };

    enqueue('first', 'manual');
    enqueue('second', 'manual');
    const first = processNextTask({ modelClient: client });
    const overlapping = processNextTask({ modelClient: client });
    await Promise.resolve();
    expect(queueLength()).toBe(1);
    releaseFirst();
    await Promise.all([first, overlapping]);
    await processNextTask({ modelClient: client });

    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
  });

  it('delivers scheduled-task results when a Slack channel is present', async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    registerSlackPoster(post);
    enqueue('scheduled summary', 'cron', { channel: 'C_TEAM' });
    const client: ModelClient = { messages: { create: vi.fn(async () => textResponse('cron result')) } };

    await processNextTask({ modelClient: client });

    expect(post).toHaveBeenCalledWith('C_TEAM', 'cron result', undefined);
  });

  it('saves a draft under the Slack thread that created it', async () => {
    registerTool(slackDraftTool);
    enqueue('draft an update', 'slack', {
      channel: 'C_ORIGIN', user: 'U_HUMAN', slackTs: '100.001',
    });
    const create = vi.fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{
          type: 'tool_use', id: 'draft-1', name: 'slack_post_draft',
          input: { channel: 'C_TARGET', text: 'Saved by runner' },
        }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockResolvedValueOnce(textResponse('Draft ready for approval.'));

    await processNextTask({ modelClient: { messages: { create } } });

    expect(getPendingDraft('C_ORIGIN', '100.001')).toMatchObject({
      originThreadTs: '100.001', targetChannel: 'C_TARGET', text: 'Saved by runner',
    });
  });
});
