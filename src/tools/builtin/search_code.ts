import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition } from '../../tool-registry';
import { getWorkspaceRoots } from '../../policy';

const execFileAsync = promisify(execFile);

// Uses ripgrep via execFile with an argument array - no shell, no string
// interpolation, so query and glob inputs cannot inject commands.
// Search scope is limited to OSKI_WORKSPACE_ROOTS, same as read_file.

const tool: ToolDefinition = {
  name: 'search_code',
  description: 'Search the configured workspace roots using ripgrep. Returns matching lines with file paths and line numbers. Scope is limited to OSKI_WORKSPACE_ROOTS.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term or regex pattern.' },
      glob: { type: 'string', description: 'File glob filter, e.g. "*.ts" or "src/**/*.ts". Optional.' },
      max_results: { type: 'number', description: 'Maximum number of results. Default 30.' },
    },
    required: ['query'],
  },
  async run({ query, glob, max_results = 30 }) {
    const roots = getWorkspaceRoots();
    if (roots.length === 0) {
      return { error: 'No workspace roots configured. Set OSKI_WORKSPACE_ROOTS in .env to grant search access.' };
    }

    const limit = Math.min(Number(max_results), 100);
    const args = ['--json', '-m', String(limit)];
    if (glob) args.push('--glob', String(glob));
    // "--" terminates flag parsing so a query starting with "-" is treated as a pattern.
    args.push('--', String(query), ...roots);

    try {
      const { stdout } = await execFileAsync('rg', args, {
        timeout: 10_000,
        maxBuffer: 5 * 1024 * 1024,
      });

      const results: Array<{ path: string; line: number; text: string }> = [];
      for (const line of stdout.split('\n').filter(Boolean)) {
        if (results.length >= limit) break;
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'match') {
            results.push({
              path: obj.data.path.text,
              line: obj.data.line_number,
              text: obj.data.lines.text.trim(),
            });
          }
        } catch { /* skip non-JSON lines */ }
      }

      return { count: results.length, results };
    } catch (err) {
      // rg exits 1 when no matches - that's not an error.
      const code = (err as { code?: number }).code;
      if (code === 1) return { count: 0, results: [] };
      if ((err as { code?: string }).code === 'ENOENT') {
        return { error: 'ripgrep (rg) is not installed. Install it: https://github.com/BurntSushi/ripgrep#installation' };
      }
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export default tool;
