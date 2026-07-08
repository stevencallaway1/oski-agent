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

const tool: ToolDefinition = {
  name: 'update_instructions',
  description: 'Append a new behavioral rule to instructions.md under the specified section. Use when given explicit feedback or an "oski learn:" command. Rules are permanent — never removes existing rules.',
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
    const ruleStr = String(rule).slice(0, POLICY.maxInstructionChars);
    if (todayEditCount() >= POLICY.dailyInstructionEditCap) {
      return { error: `Daily instruction edit cap (${POLICY.dailyInstructionEditCap}) reached. Try again tomorrow.` };
    }

    let content = fs.readFileSync(INSTRUCTIONS_PATH, 'utf8');
    const sectionHeader = `## ${section}`;

    if (content.includes(sectionHeader)) {
      // Append after the section header's block.
      content = content.replace(sectionHeader, `${sectionHeader}\n- ${ruleStr}`);
    } else {
      // Create a new section before the last "---" separator or at end of file.
      const insertion = `\n## ${section}\n\n- ${ruleStr}\n`;
      const lastSep = content.lastIndexOf('\n---');
      if (lastSep !== -1) {
        content = content.slice(0, lastSep) + insertion + content.slice(lastSep);
      } else {
        content += insertion;
      }
    }

    fs.writeFileSync(INSTRUCTIONS_PATH, content, 'utf8');

    const logEntry = { ts: new Date().toISOString(), section, rule: ruleStr };
    fs.appendFileSync(EDIT_LOG, JSON.stringify(logEntry) + '\n', 'utf8');

    return {
      ok: true,
      section,
      rule: ruleStr,
      note: 'Rule appended to instructions.md. Oski will follow it from the next turn onward.',
    };
  },
};

export default tool;
