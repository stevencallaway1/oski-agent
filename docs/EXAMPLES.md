# Examples

Realistic walkthroughs of what Oski actually does, using the tools and commands that ship in this repo. Every example below maps to real code. No hypothetical tools.

## Summarize a repo

```
You:  oski: summarize what this repo does based on its README and TODO.md
Oski: Working on it... (task 7c1a02de)
Oski: This repo is a [summary based on file contents]. Open items in TODO.md:
      ship the billing fix, write the onboarding doc, schedule the retro.
```

Under the hood: the model calls `read_file` against `README.md` and `TODO.md`, both resolved relative to a directory in `OSKI_WORKSPACE_ROOTS`. If those roots are empty, `read_file` returns `{ error: 'No workspace roots configured...' }` instead of silently failing.

## Draft a Slack update

```
You:  oski: draft an internal update about this week's progress
Oski: DRAFT (not posted): "This week: billing fix shipped, onboarding doc
      in review, retro scheduled Fri. No blockers." Reply 'send it' to post live.
You (same thread): send it
Oski: Posted the saved draft. Human approval logged for the task.
```

Under the hood: the model calls `slack_post_draft`. Unless `slack_post_draft` is in `OSKI_LIVE_TOOLS`, the tool returns `{ mode: 'draft', ... }` and the system prompt requires the agent to paste the full draft text into its reply. In Socket Mode, the runner also saves that draft under the originating Slack thread. Only a human reply of `approve` or `send it` in that thread can post it. The approval is appended to `data/agent/approvals.jsonl` after the post succeeds.

## Search docs for a decision

```
You:  oski: search the workspace for where rate limiting is handled
Oski: Found 3 matches: src/runner.ts:41 (rate_limit retry check),
      docs/ARCHITECTURE.md:33 (retry/backoff description), ...
```

Under the hood: `search_code` shells out to `rg --json` with an argument array (never a shell string), scoped to `OSKI_WORKSPACE_ROOTS`. Results include file path, line number, and matched text.

## Inspect TODO.md

```
You:  oski status
Oski: *Oski Status*
      Queue: 0 pending
      Tools: 6 loaded
      Daily spend: $0.0421 / $2 cap
      Week spend: $0.1877
      Policy violations today: 0
      Recent failures: 0
      Last task: "check team status" (2m ago, success)
```

`oski status` is one of the immediate commands (`status`, `help`, `tools`, `cost`) that bypass the queue entirely and reply synchronously. See `handleStatusCommand` in `src/channels/socket-mode.ts`.

## Add a behavioral rule

```
You:  oski learn: always mention owners by name in summaries
Oski: Got it. Learning: "always mention owners by name in summaries"
```

Under the hood: the message is parsed by `parseOskiCommand()` into a `learn` command, enqueued as a task instructing the model to call `update_instructions`, which appends a bullet to `instructions.md` under the relevant `##` section and logs the edit to `data/agent/instruction-edits.jsonl`. Capped at 5 edits/day, 500 characters each.

## Create a read-only custom tool

A minimal custom tool, following the pattern in every file under `src/tools/builtin/`:

```ts
// src/tools/builtin/check_open_prs.ts
import type { ToolDefinition } from '../../tool-registry';

const tool: ToolDefinition = {
  name: 'check_open_prs',
  description: 'List open pull request titles from a local git checkout.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      repo_path: { type: 'string', description: 'Absolute path to a git repo.' },
    },
    required: ['repo_path'],
  },
  async run({ repo_path }) {
    // Real implementation would shell out via execFile (never a shell string)
    // and stay inside OSKI_WORKSPACE_ROOTS, same as read_file/search_code.
    return { error: 'not implemented, this is a template' };
  },
};

export default tool;
```

Drop it in `src/tools/builtin/`, restart, and confirm it loaded with `npm run agent:task -- "list your loaded tools"` or `oski tools` in Slack. See [README.md#tool-development](../README.md#tool-development) for the full checklist.

## Run a daily status check

```bash
# .env
OSKI_CRON_ENABLED=true
```

With cron enabled, two example jobs in `src/channels/cron.ts` fire on weekdays (15:30 and 18:00 UTC): one summarizes anything updated in the workspace in the last 24 hours, the other flags anything that looks blocked or overdue. Both are enqueued through the same runner and cost log. When `OSKI_SLACK_CHANNEL_ID` and `OSKI_SLACK_BOT_TOKEN` are configured, their final results are posted to that channel. Edit the cron expressions and task text in that file to match your team's schedule.
