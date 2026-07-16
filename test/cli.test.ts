import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('CLI output', () => {
  it('prints the final agent response', async () => {
    const repo = path.resolve(__dirname, '..');
    const { stdout } = await execFileAsync(process.execPath, [
      path.join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join(repo, 'src', 'cli.ts'),
      'summarize the demo workspace',
    ], {
      cwd: repo,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: '',
        OSKI_MOCK: 'true',
        OSKI_WORKSPACE_ROOTS: path.join(repo, 'examples', 'workspace'),
      },
    });

    expect(stdout).toContain('[oski:cli] Agent response:');
    expect(stdout).toContain('Demo workspace summary');
  });
});
