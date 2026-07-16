import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition } from '../../tool-registry';
import { POLICY, isCodegenEnabled } from '../../policy';
import { COST_LOG } from '../../paths';

// EXPERIMENTAL - OFF BY DEFAULT.
// This tool lets the agent author new tools by shelling out to the Claude Code
// CLI. It only runs when OSKI_ENABLE_CODEGEN=true. Generated tools load with
// scope "read" and full process permissions - ALWAYS review generated code
// before trusting it, and never add a generated tool to OSKI_LIVE_TOOLS
// without reading it first.

const execFileAsync = promisify(execFile);

const GENERATED_DIR = path.join(__dirname, '..', 'generated');

// Claude Code CLI binary - override with CLAUDE_CLI_PATH env var.
const CLAUDE_BIN = process.env.CLAUDE_CLI_PATH ?? 'claude';

function todayGenerateCount(): number {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const lines = fs.readFileSync(COST_LOG, 'utf8').trim().split('\n').filter(Boolean);
    return lines.filter(l => {
      try {
        const e = JSON.parse(l) as { ts: string; toolCalls: string[] };
        return e.ts.startsWith(today) && e.toolCalls.includes('generate_tool');
      } catch { return false; }
    }).length;
  } catch { return 0; }
}

const TOOL_TEMPLATE = `import type { ToolDefinition } from '../../tool-registry';

// SPEC: {{spec}}
const tool: ToolDefinition = {
  name: '{{name}}',
  description: '',   // fill in
  scope: 'read',     // read | draft | live - start conservative
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  async run(input) {
    // TODO: implement
    return { error: 'not implemented' };
  },
};

export default tool;
`;

const tool: ToolDefinition = {
  name: 'generate_tool',
  description: 'EXPERIMENTAL (requires OSKI_ENABLE_CODEGEN=true): ask the Claude Code CLI to author a new tool and save it to src/tools/generated/. The tool-registry hot-reloads it. Generated tools must be human-reviewed before being trusted. Capped at 3 per day.',
  scope: 'live',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'snake_case tool name, e.g. "check_deploy_status".' },
      spec: { type: 'string', description: 'Plain-language description of what the tool should do, what APIs it should call, and what it should return.' },
    },
    required: ['name', 'spec'],
  },
  async run({ name, spec }) {
    if (!isCodegenEnabled()) {
      return { error: 'Tool generation is disabled. Set OSKI_ENABLE_CODEGEN=true to enable this experimental feature, and read the safety notes in the README first.' };
    }

    const toolName = String(name).replace(/[^a-z0-9_]/g, '_').slice(0, 40);
    const toolSpec = String(spec).slice(0, 1000);

    if (todayGenerateCount() >= POLICY.dailyGenerateToolCap) {
      return { error: `Daily generate_tool cap (${POLICY.dailyGenerateToolCap}) reached. Try again tomorrow.` };
    }

    const outputPath = path.join(GENERATED_DIR, `${toolName}.ts`);

    if (fs.existsSync(outputPath)) {
      return { error: `Tool "${toolName}" already exists at ${outputPath}. Delete it first to regenerate.` };
    }

    fs.mkdirSync(GENERATED_DIR, { recursive: true });

    // Write a scaffold so the CLI has a concrete file to edit.
    const scaffold = TOOL_TEMPLATE
      .replace('{{name}}', toolName)
      .replace('{{spec}}', toolSpec);
    fs.writeFileSync(outputPath, scaffold, 'utf8');

    const prompt = `You are writing a TypeScript tool for the Oski internal ops agent.

File to implement: ${outputPath}

Spec: ${toolSpec}

Rules:
- The file must export a default ToolDefinition object (see the scaffold).
- Use only npm packages already in this project's package.json.
- scope must be "read" unless the spec explicitly requires writes.
- Every error must be caught and returned as { error: string }, never thrown.
- No comments unless the WHY is non-obvious.
- TypeScript strict mode, no any types.
- Max 80 lines. If it needs more, split into a helper function in the same file.

Read the scaffold at ${outputPath}, implement it fully, and write it back. Do not create any other files.`;

    const tmpPrompt = path.join(os.tmpdir(), `oski-generate-${Date.now()}.txt`);
    fs.writeFileSync(tmpPrompt, prompt, 'utf8');

    try {
      const { stdout, stderr } = await execFileAsync(
        CLAUDE_BIN,
        [
          '--print',
          `@${tmpPrompt}`,
          '--allowedTools', 'Read,Edit,Write',
          '--add-dir', GENERATED_DIR,
          '--output-format', 'text',
        ],
        { timeout: 120_000, cwd: process.cwd() }
      );

      if (stderr) console.warn(`[oski:generate_tool] claude stderr:`, stderr.slice(0, 500));

      const exists = fs.existsSync(outputPath);
      return {
        ok: exists,
        tool_name: toolName,
        path: outputPath,
        note: exists
          ? `Tool "${toolName}" written. Tool-registry will hot-reload it. REVIEW the code at ${outputPath} before trusting it for live writes.`
          : `Claude Code ran but the file was not written. stdout: ${stdout.slice(0, 300)}`,
      };
    } catch (err) {
      // Clean up failed scaffold so it doesn't block a retry.
      try { fs.unlinkSync(outputPath); } catch { /* ok */ }
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      try { fs.unlinkSync(tmpPrompt); } catch { /* ok */ }
    }
  },
};

export default tool;
