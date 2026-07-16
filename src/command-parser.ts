// Parses raw Slack message text into structured Oski commands.
// All matching is case-insensitive and strips Slack mention syntax.

export type OskiCommand =
  | { type: 'task'; text: string }
  | { type: 'learn'; rule: string }
  | { type: 'status' }
  | { type: 'help' }
  | { type: 'tools' }
  | { type: 'cost' }
  | null;

function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/gi, '').trim();
}

export function parseOskiCommand(rawText: string): OskiCommand {
  const text = stripMentions(rawText).trim();
  const lower = text.toLowerCase();

  // oski learn: <rule>
  const learnMatch = lower.match(/^oski\s+learn:\s*/);
  if (learnMatch) {
    const rule = text.slice(learnMatch[0].length).trim();
    if (!rule) return null;
    return { type: 'learn', rule };
  }

  // oski: <task>  or  oski, <task>
  const taskMatch = lower.match(/^oski[,:]\s*/);
  if (taskMatch) {
    const taskText = text.slice(taskMatch[0].length).trim();
    if (!taskText) return null;
    return { type: 'task', text: taskText };
  }

  // Exact keywords (no colon required).
  if (lower === 'oski status' || lower === 'oski: status') return { type: 'status' };
  if (lower === 'oski help' || lower === 'oski: help') return { type: 'help' };
  if (lower === 'oski tools' || lower === 'oski: tools') return { type: 'tools' };
  if (lower === 'oski cost' || lower === 'oski: cost') return { type: 'cost' };

  // A bare @mention with no text (e.g. "@Oski") - treat as help.
  if (/^<@[A-Z0-9]+>$/i.test(rawText.trim())) return { type: 'help' };

  return null;
}
