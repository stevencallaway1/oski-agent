import fs from 'fs';
import type { ToolDefinition } from '../../tool-registry';
import { POLICY } from '../../policy';
import { INSTRUCTIONS_PATH, EDIT_LOG } from '../../paths';

function todayEditCount(): number {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const lines = fs.readFileSync(EDIT_LOG, 'utf8').trim().split('\n').filter(Boolean);
    return lines.filter(l => {
      try { return (JSON.parse(l) as { ts: string }).ts.startsWith(today); } catch { return false; }
    }).length;
  } catch { return 0; }
}

export function sanitizeInstructionInput(section: unknown, rule: unknown): { section: string; rule: string } {
  const cleanSection = String(section)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/#/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const cleanRule = String(rule)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, POLICY.maxInstructionChars);

  if (!cleanSection) throw new Error('Instruction section is empty after sanitization.');
  if (!cleanRule) throw new Error('Instruction rule is empty after sanitization.');
  return { section: cleanSection, rule: cleanRule };
}

const tool: ToolDefinition = {
  name: 'update_instructions',
  description: 'Append a new behavioral rule to instructions.md under the specified section. Use when given explicit feedback or an "oski learn:" command. Rules are permanent - never removes existing rules.',
  scope: 'live',
  inputSchema: {
    type: 'object',
    properties: {
      section: { type: 'string', description: 'Section header in instructions.md to append under, e.g. "Tone" or "Schedule".' },
      rule: { type: 'string', description: 'The rule to append. Plain text, one to three sentences max.' },
    },
    required: ['section', 'rule'],
  },
  async run({ section, rule }) {
    let sanitized: { section: string; rule: string };
    try {
      sanitized = sanitizeInstructionInput(section, rule);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    const { section: sectionStr, rule: ruleStr } = sanitized;
    if (todayEditCount() >= POLICY.dailyInstructionEditCap) {
      return { error: `Daily instruction edit cap (${POLICY.dailyInstructionEditCap}) reached. Try again tomorrow.` };
    }

    let content = fs.readFileSync(INSTRUCTIONS_PATH, 'utf8');
    const sectionHeader = `## ${sectionStr}`;

    if (content.includes(sectionHeader)) {
      const headerIndex = content.indexOf(sectionHeader);
      const insertAt = headerIndex + sectionHeader.length;
      content = content.slice(0, insertAt) + `\n- ${ruleStr}` + content.slice(insertAt);
    } else {
      // Create a new section before the last "---" separator or at end of file.
      const insertion = `\n## ${sectionStr}\n\n- ${ruleStr}\n`;
      const lastSep = content.lastIndexOf('\n---');
      if (lastSep !== -1) {
        content = content.slice(0, lastSep) + insertion + content.slice(lastSep);
      } else {
        content += insertion;
      }
    }

    fs.writeFileSync(INSTRUCTIONS_PATH, content, 'utf8');

    const logEntry = { ts: new Date().toISOString(), section: sectionStr, rule: ruleStr };
    fs.appendFileSync(EDIT_LOG, JSON.stringify(logEntry) + '\n', 'utf8');

    return {
      ok: true,
      section: sectionStr,
      rule: ruleStr,
      note: 'Rule appended to instructions.md. Oski will follow it from the next turn onward.',
    };
  },
};

export default tool;
