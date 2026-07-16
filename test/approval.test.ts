import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { approvePendingDraft, getPendingDraft, savePendingDraft } from '../src/approvals';

describe('human Slack approval', () => {
  const draft = {
    taskId: 'task-1',
    originChannel: 'C_ORIGIN',
    originThreadTs: '100.001',
    targetChannel: 'C_TARGET',
    targetThreadTs: '200.002',
    text: 'Saved draft text',
  };

  beforeEach(() => savePendingDraft(draft));

  it('posts the saved draft and appends an approval record from the correct thread', async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oski-approval-')), 'approvals.jsonl');

    const result = await approvePendingDraft({
      channel: 'C_ORIGIN', threadTs: '100.001', userId: 'U_HUMAN', isBot: false,
    }, post, { logPath });

    expect(result).toMatchObject({ approved: true, taskId: 'task-1' });
    expect(post).toHaveBeenCalledWith('C_TARGET', 'Saved draft text', '200.002');
    expect(JSON.parse(fs.readFileSync(logPath, 'utf8').trim())).toMatchObject({
      event: 'slack_draft_approved', taskId: 'task-1', approvedBy: 'U_HUMAN',
    });
    expect(getPendingDraft('C_ORIGIN', '100.001')).toBeUndefined();
  });

  it('rejects approval outside the originating thread', async () => {
    const post = vi.fn();
    const result = await approvePendingDraft({
      channel: 'C_ORIGIN', threadTs: 'wrong-thread', userId: 'U_HUMAN', isBot: false,
    }, post);
    expect(result).toMatchObject({ approved: false });
    expect(post).not.toHaveBeenCalled();
  });

  it('never accepts approval from a bot', async () => {
    const post = vi.fn();
    const result = await approvePendingDraft({
      channel: 'C_ORIGIN', threadTs: '100.001', userId: 'B_OSKI', isBot: true,
    }, post);
    expect(result).toMatchObject({ approved: false, reason: expect.stringContaining('human') });
    expect(post).not.toHaveBeenCalled();
  });
});
