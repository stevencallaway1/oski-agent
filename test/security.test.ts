import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import readFileTool from '../src/tools/builtin/read_file';
import slackDraftTool from '../src/tools/builtin/slack_post_draft';
import { sanitizeInstructionInput } from '../src/tools/builtin/update_instructions';
import { validateSlackSignature } from '../src/channels/slack-events';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('draft-first behavior', () => {
  it('returns a draft without calling Slack when the tool is not live', async () => {
    vi.stubEnv('OSKI_LIVE_TOOLS', '');
    const result = await slackDraftTool.run({ channel: '#team', text: 'hello' });
    expect(result).toMatchObject({ mode: 'draft', channel: '#team', text: 'hello' });
  });
});

describe('file allowlisted roots', () => {
  it('rejects path traversal and symlinks that escape the configured root', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'oski-files-'));
    const root = path.join(parent, 'workspace');
    const outside = path.join(parent, 'secret.txt');
    fs.mkdirSync(root);
    fs.writeFileSync(outside, 'secret');
    fs.symlinkSync(outside, path.join(root, 'link.txt'));
    vi.stubEnv('OSKI_WORKSPACE_ROOTS', root);

    await expect(readFileTool.run({ file_path: '../secret.txt' })).resolves.toMatchObject({
      error: expect.stringContaining('outside'),
    });
    await expect(readFileTool.run({ file_path: 'link.txt' })).resolves.toMatchObject({
      error: expect.stringContaining('resolves outside'),
    });
  });
});

describe('instruction-update sanitization', () => {
  it('flattens markdown structure and preserves literal replacement tokens', () => {
    expect(sanitizeInstructionInput('Tone\n## Injected', "Keep $& and $' literal\n- not a new rule")).toEqual({
      section: 'Tone Injected',
      rule: "Keep $& and $' literal - not a new rule",
    });
  });

  it('rejects empty sanitized values', () => {
    expect(() => sanitizeInstructionInput('###', '\n\r')).toThrow(/section/i);
  });
});

describe('Slack request signatures', () => {
  it('accepts a valid signature and rejects invalid or stale signatures', () => {
    const secret = 'test-secret';
    const body = JSON.stringify({ type: 'event_callback' });
    const nowSeconds = 1_800_000_000;
    const timestamp = String(nowSeconds);
    const signature = 'v0=' + crypto
      .createHmac('sha256', secret)
      .update(`v0:${timestamp}:${body}`)
      .digest('hex');

    expect(validateSlackSignature({ secret, timestamp, signature, rawBody: body, nowMs: nowSeconds * 1000 })).toBe(true);
    expect(validateSlackSignature({ secret, timestamp, signature: 'v0=bad', rawBody: body, nowMs: nowSeconds * 1000 })).toBe(false);
    expect(validateSlackSignature({ secret, timestamp: String(nowSeconds - 301), signature, rawBody: body, nowMs: nowSeconds * 1000 })).toBe(false);
  });
});
