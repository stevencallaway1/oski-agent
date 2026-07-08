import fs from 'fs';
import path from 'path';
import type { ToolDefinition } from '../../tool-registry';
import { getWorkspaceRoots } from '../../policy';

// File access is deny-by-default. The agent can only read files under the
// directories explicitly listed in OSKI_WORKSPACE_ROOTS (comma-separated).
// Both the lexically resolved path and the symlink-resolved real path must
// fall inside an allowed root, so symlinks cannot escape the sandbox.

function isInsideRoot(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isAllowed(target: string): boolean {
  const roots = getWorkspaceRoots();
  return roots.some(root => isInsideRoot(target, root));
}

const tool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file. Access is restricted to the directories configured in OSKI_WORKSPACE_ROOTS. Everything else is denied.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file. Absolute, or relative to the first configured workspace root.' },
      max_lines: { type: 'number', description: 'Maximum number of lines to return. Default 200.' },
    },
    required: ['file_path'],
  },
  async run({ file_path, max_lines = 200 }) {
    const roots = getWorkspaceRoots();
    if (roots.length === 0) {
      return { error: 'No workspace roots configured. Set OSKI_WORKSPACE_ROOTS in .env to grant read access.' };
    }

    const requested = String(file_path);
    const resolved = path.isAbsolute(requested)
      ? path.resolve(requested)
      : path.resolve(roots[0], requested);

    if (!isAllowed(resolved)) {
      return { error: `Access denied: ${requested} is outside the configured workspace roots.` };
    }

    if (!fs.existsSync(resolved)) {
      return { error: `File not found: ${resolved}` };
    }

    // Re-check after resolving symlinks so a link inside a root cannot point outside it.
    const real = fs.realpathSync(resolved);
    if (!isAllowed(real)) {
      return { error: `Access denied: ${requested} resolves outside the configured workspace roots.` };
    }

    const stat = fs.statSync(real);
    if (stat.isDirectory()) {
      return { error: 'Path is a directory. Use search_code instead.' };
    }

    const content = fs.readFileSync(real, 'utf8');
    const lines = content.split('\n');
    const limit = Math.min(Number(max_lines), 500);
    const sliced = lines.slice(0, limit);
    const truncated = lines.length > limit;

    return {
      path: real,
      lines: sliced.length,
      total_lines: lines.length,
      truncated,
      content: sliced.join('\n'),
    };
  },
};

export default tool;
