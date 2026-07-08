import type { ToolDefinition } from '../../tool-registry';
import { isToolLive } from '../../policy';

const tool: ToolDefinition = {
  name: 'slack_post_draft',
  description: 'Compose a Slack message and either post it live (if tool is trusted in policy) or return the draft text for human review. Always defaults to draft mode.',
  scope: 'draft',
  inputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'Slack channel name or ID, e.g. "#general" or "C0123456789".' },
      text: { type: 'string', description: 'Message text (plain or markdown).' },
      thread_ts: { type: 'string', description: 'Optional: reply in thread by providing parent message timestamp.' },
    },
    required: ['channel', 'text'],
  },
  async run({ channel, text, thread_ts }) {
    if (!isToolLive('slack_post_draft')) {
      return {
        mode: 'draft',
        channel,
        text,
        thread_ts: thread_ts ?? null,
        note: 'DRAFT: Not posted. Add "slack_post_draft" to OSKI_LIVE_TOOLS to enable live posting.',
      };
    }

    // Live mode: post via Slack API using the agent bot token.
    const { WebClient } = await import('@slack/web-api');
    const token = process.env.OSKI_SLACK_BOT_TOKEN;
    if (!token) return { error: 'OSKI_SLACK_BOT_TOKEN not configured.' };

    const client = new WebClient(token);
    const result = await client.chat.postMessage({
      channel: String(channel),
      text: String(text),
      ...(thread_ts ? { thread_ts: String(thread_ts) } : {}),
    });

    return { mode: 'live', ts: result.ts, channel: result.channel };
  },
};

export default tool;
