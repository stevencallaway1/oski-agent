import path from 'path';

// Oski agent policy: budget caps, model routing, tool scope enforcement.

export const POLICY = {
  // Halt and alert when daily spend crosses this threshold.
  dailyCapUsd: parseFloat(process.env.OSKI_DAILY_USD_CAP ?? '2'),

  // Default model for routing/triage turns. Configurable — no hardcoded assumptions.
  defaultModel: process.env.ANTHROPIC_MODEL_DEFAULT ?? 'claude-haiku-4-5',

  // Elevated model for reasoning-heavy tasks. Runner promotes when needed.
  reasoningModel: process.env.ANTHROPIC_MODEL_REASONING ?? 'claude-sonnet-4-5',

  // Max tokens per turn (controls cost).
  maxOutputTokens: parseInt(process.env.OSKI_MAX_OUTPUT_TOKENS ?? '2048', 10),

  // Max self-generated tool invocations per day (generate_tool is expensive).
  dailyGenerateToolCap: 3,

  // Max characters the agent may append to instructions.md per call.
  maxInstructionChars: 500,

  // Max instruction edits per day.
  dailyInstructionEditCap: 5,

  // Tools that are "live" (side-effectful writes allowed). Empty = all in draft mode.
  // To trust a tool: add its name here, e.g. 'slack_post_draft'.
  liveTools: (process.env.OSKI_LIVE_TOOLS ?? '').split(',').map(s => s.trim()).filter(Boolean),
};

export type ToolScope = 'read' | 'draft' | 'live';

export function isToolLive(toolName: string): boolean {
  return POLICY.liveTools.includes(toolName);
}

// EXPERIMENTAL: self-authored tools are opt-in and off by default.
export function isCodegenEnabled(): boolean {
  return process.env.OSKI_ENABLE_CODEGEN === 'true';
}

// Directories the agent may read and search. Read at call time so tests can
// override. EMPTY MEANS NO ACCESS — there is deliberately no default root.
export function getWorkspaceRoots(): string[] {
  return (process.env.OSKI_WORKSPACE_ROOTS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(p => path.resolve(p));
}
