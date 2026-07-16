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

  it('atomically approves a draft when two requests race', async () => {
    let release!: () => void;
    const post = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const request = { channel: 'C_ORIGIN', threadTs: '100.001', userId: 'U_HUMAN', isBot: false };
    const first = approvePendingDraft(request, post);
    const second = await approvePendingDraft({ ...request, userId: 'U_OTHER' }, post);
    release();
    const firstResult = await first;
    expect(firstResult.approved).toBe(true);
    expect(second.approved).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('restores the draft when the Slack post fails', async () => {
    const post = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await approvePendingDraft({
      channel: 'C_ORIGIN', threadTs: '100.001', userId: 'U_HUMAN', isBot: false,
    }, post);
    expect(result).toMatchObject({ approved: false, reason: expect.stringContaining('Slack post failed') });
    expect(getPendingDraft('C_ORIGIN', '100.001')).toBeDefined();
  });

  it('does not restore or repost after an audit-log failure', async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const result = await approvePendingDraft({
      channel: 'C_ORIGIN', threadTs: '100.001', userId: 'U_HUMAN', isBot: false,
    }, post, { logPath: path.join('/definitely-missing', 'approvals.jsonl') });
    expect(result).toMatchObject({ approved: true, reason: expect.stringContaining('audit logging failed') });
    expect(getPendingDraft('C_ORIGIN', '100.001')).toBeUndefined();
    const second = await approvePendingDraft({
      channel: 'C_ORIGIN', threadTs: '100.001', userId: 'U_HUMAN', isBot: false,
    }, post);
    expect(second.approved).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
