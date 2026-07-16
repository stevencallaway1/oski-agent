import fs from 'fs';
import { APPROVAL_LOG } from './paths';

export interface PendingDraft {
  taskId: string;
  originChannel: string;
  originThreadTs: string;
  targetChannel: string;
  targetThreadTs?: string;
  text: string;
}

export interface ApprovalRequest {
  channel: string;
  threadTs?: string;
  userId: string;
  isBot: boolean;
}

type SlackPoster = (channel: string, text: string, threadTs?: string) => Promise<void>;

const pendingDrafts = new Map<string, PendingDraft>();

function draftKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`;
}

export function savePendingDraft(draft: PendingDraft): void {
  pendingDrafts.set(draftKey(draft.originChannel, draft.originThreadTs), draft);
}

export function getPendingDraft(channel: string, threadTs: string): PendingDraft | undefined {
  return pendingDrafts.get(draftKey(channel, threadTs));
}

export async function approvePendingDraft(
  request: ApprovalRequest,
  post: SlackPoster,
  options: { logPath?: string } = {}
): Promise<{ approved: boolean; taskId?: string; reason?: string }> {
  if (request.isBot || !request.userId) {
    return { approved: false, reason: 'Approval requires a human Slack user.' };
  }
  if (!request.threadTs) {
    return { approved: false, reason: 'Approval must be sent inside the draft thread.' };
  }

  const key = draftKey(request.channel, request.threadTs);
  const draft = pendingDrafts.get(key);
  if (!draft) {
    return { approved: false, reason: 'No pending draft exists in this Slack thread.' };
  }

  // Consume before awaiting the network call. JavaScript execution is synchronous
  // until the first await, so concurrent approvals cannot claim the same draft.
  pendingDrafts.delete(key);

  try {
    await post(draft.targetChannel, draft.text, draft.targetThreadTs);
  } catch (err) {
    if (!pendingDrafts.has(key)) pendingDrafts.set(key, draft);
    return { approved: false, reason: `Slack post failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const approvedAt = new Date().toISOString();
  try {
    fs.appendFileSync(options.logPath ?? APPROVAL_LOG, JSON.stringify({
      event: 'slack_draft_approved',
      approvedAt,
      approvedBy: request.userId,
      taskId: draft.taskId,
      originChannel: draft.originChannel,
      originThreadTs: draft.originThreadTs,
      targetChannel: draft.targetChannel,
      targetThreadTs: draft.targetThreadTs ?? null,
    }) + '\n', 'utf8');
  } catch (err) {
    const reason = `Slack post succeeded, but approval audit logging failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[oski:approval] ${reason}`);
    return { approved: true, taskId: draft.taskId, reason };
  }

  return { approved: true, taskId: draft.taskId };
}
