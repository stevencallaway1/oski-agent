import type { ModelClient, ModelResponse } from './runner';

export class MockModelClient implements ModelClient {
  private step = 0;

  readonly messages = {
    create: async (): Promise<ModelResponse> => {
      this.step++;
      if (this.step === 1) {
        return {
          stop_reason: 'tool_use',
          content: [{
            type: 'tool_use',
            id: 'mock-read-todo',
            name: 'read_file',
            input: { file_path: 'TODO.md', max_lines: 50 },
          }],
          usage: { input_tokens: 40, output_tokens: 20 },
        };
      }
      if (this.step === 2) {
        return {
          stop_reason: 'tool_use',
          content: [{
            type: 'tool_use',
            id: 'mock-draft-update',
            name: 'slack_post_draft',
            input: {
              channel: '#team-updates',
              text: 'Demo update: document the approval flow, verify the cost table, and ship the focused test suite.',
            },
          }],
          usage: { input_tokens: 80, output_tokens: 35 },
        };
      }
      return {
        stop_reason: 'end_turn',
        content: [{
          type: 'text',
          text: 'Demo workspace summary: 3 open items found.\n\nDraft: Demo update: document the approval flow, verify the cost table, and ship the focused test suite.\n\nThe draft was not posted.',
        }],
        usage: { input_tokens: 100, output_tokens: 45 },
      };
    },
  };
}
