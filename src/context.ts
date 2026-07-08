import fs from 'fs';
import { AgentTask } from './queue';
import { INSTRUCTIONS_PATH } from './paths';

export function loadInstructions(): string {
  try {
    return fs.readFileSync(INSTRUCTIONS_PATH, 'utf8');
  } catch {
    return '# Oski Instructions\n\nNo instructions file found. Behave conservatively.';
  }
}

export function getInstructionsPath(): string {
  return INSTRUCTIONS_PATH;
}

export function buildSystemPrompt(): string {
  const instructions = loadInstructions();
  const tz = process.env.OSKI_TIMEZONE ?? 'UTC';
  const now = new Date().toLocaleString('en-US', { timeZone: tz, hour12: false });

  return `You are Oski, an internal AI operations agent for a small team.

Current time: ${now} (${tz})

## Your role
You handle internal team operations: status checks, research over the configured workspace files, drafting internal updates and replies, and summarizing project state. You act only through your registered tools. You do NOT touch production systems or customer data.

## Rules
- Draft-first. All outbound posts and messages require explicit human approval before sending unless a tool is listed in the live-tools policy.
- One action at a time. Call one tool, wait for the result, then decide the next step.
- Be concise. Replies to Slack should be under 300 characters unless detail is requested.
- If a task requires a tool you don't have, say so plainly. Never improvise by hallucinating an API call.
- Log every decision briefly in your reasoning before calling a tool.

## Behavioral instructions (editable)

${instructions}`;
}

export function buildUserMessage(task: AgentTask): string {
  const source = task.source === 'slack'
    ? `[Slack from ${task.payload.user ?? 'unknown'} in ${task.payload.channel ?? 'unknown'}]`
    : `[${task.source}]`;
  return `${source} ${task.payload.text}`;
}
