# Oski

**A Slack-native internal ops agent for small teams.**

Oski reads approved context, uses a typed tool registry, drafts replies and actions, tracks cost, and can be extended with custom tools. Message it in Slack (`oski: check team status`) or run it from the CLI. Everything defaults to draft mode: nothing posts, sends, or writes without explicit human approval.

## Who it's for

Founders, operators, and small teams who want an internal agent that:

- answers questions about their own files and notes without copy-pasting into a chat window,
- drafts internal updates and replies for human review,
- learns behavioral rules from plain-English feedback (`oski learn: keep replies under 2 sentences`),
- stays inside a hard daily budget.

It is deliberately not an autonomous system. It is an internal drafting and operations assistant with explicit human approval.

## Demo flow

```
You (in Slack):  oski: summarize the open items in TODO.md
Oski:            Got it. Working on it... (task 3f2a91bc)
Oski (in thread): 3 open items: ship the billing fix (owner: A), write the
                  onboarding doc (owner: B, overdue), schedule the retro.

You:             oski: draft an internal update about this week's progress
Oski (in thread): DRAFT (not posted): "This week: billing fix shipped, onboarding
                  doc in review, retro scheduled Fri..." Reply 'send it' to post live.

You:             oski learn: always mention owners by name in summaries
Oski:            Got it. Learning: "always mention owners by name in summaries"

You:             oski cost
Oski:            Today: $0.0312 / $2 cap. This week: $0.1877.
```

## Architecture

```
Inbound channels
  Slack Socket Mode  ──┐
  node-cron (opt-in)   ├──► queue.ts (FIFO) ──► runner.ts ──► Anthropic API
  CLI (agent:task)   ──┘                                         │
                                                                 │ tool_use
                                                                 ▼
                                                        tool-registry.ts
                                                          /           \
                                                tools/builtin/    tools/generated/
                                                (hand-written)    (agent-authored,
                                                                   opt-in, reviewed)
```

- **Queue.** In-memory FIFO with an append-only JSONL mirror at `data/agent/queue.jsonl`. One task at a time (concurrency = 1) keeps cost predictable.
- **Runner.** Each task is an agentic loop: the model can call tools in sequence, up to 10 steps, before producing a final reply. A cheap model handles routing; the runner automatically promotes to a stronger model on multi-step tasks. Retries with backoff on rate limits, hard timeout at 120s.
- **Tools.** Every tool is a TypeScript file exporting a typed `ToolDefinition` with a `read` / `draft` / `live` scope. The registry discovers them at startup and hot-reloads the generated directory.
- **Cost log.** Every turn writes model, tokens, and estimated USD to `data/agent/cost.jsonl`. The queue pauses when `OSKI_DAILY_USD_CAP` is hit.
- **Instructions.** `instructions.md` is loaded fresh on every turn. Anyone on the team can append rules via `oski learn:` in Slack. No redeploy.

## Setup

Requirements: Node 20+, an Anthropic API key, and [ripgrep](https://github.com/BurntSushi/ripgrep#installation) (`rg`) for the `search_code` tool.

```bash
git clone <your-fork-url> oski-agent
cd oski-agent
npm install
cp .env.example .env
# edit .env: add ANTHROPIC_API_KEY, set OSKI_WORKSPACE_ROOTS
```

Run a task from the CLI (no Slack needed):

```bash
npm run agent:task -- "list your loaded tools"
```

Start the agent (Slack if configured, otherwise CLI-only mode):

```bash
npm run dev
```

Build and run compiled:

```bash
npm run build
npm start
```

## Slack setup

Full walkthrough in [docs/SLACK_SETUP.md](docs/SLACK_SETUP.md). Short version: create a Slack app, enable Socket Mode, add bot scopes, install to your workspace, invite the bot to one channel, and set three env vars (`OSKI_SLACK_APP_TOKEN`, `OSKI_SLACK_BOT_TOKEN`, `OSKI_SLACK_CHANNEL_ID`). Socket Mode means no public URL and no webhook configuration.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Anthropic API access |
| `ANTHROPIC_MODEL_DEFAULT` | no | Cheap model for routing/triage (default `claude-haiku-4-5`) |
| `ANTHROPIC_MODEL_REASONING` | no | Stronger model for multi-step tasks (default `claude-sonnet-4-5`) |
| `OSKI_WORKSPACE_ROOTS` | for file tools | Comma-separated dirs the agent may read/search. **Empty = no access.** |
| `OSKI_DAILY_USD_CAP` | no | Daily spend cap in USD (default `2`) |
| `OSKI_LIVE_TOOLS` | no | Comma-separated tools allowed live writes. **Empty = all draft.** |
| `OSKI_SLACK_APP_TOKEN` | for Slack | App-level token for Socket Mode |
| `OSKI_SLACK_BOT_TOKEN` | for Slack | Bot user OAuth token |
| `OSKI_SLACK_CHANNEL_ID` | for Slack | Channel where Oski listens |
| `OSKI_SLACK_SIGNING_SECRET` | no | Only for the HTTP Events API fallback |
| `OSKI_ENABLE_CODEGEN` | no | EXPERIMENTAL self-authored tools (default `false`) |
| `CLAUDE_CLI_PATH` | no | Path to the Claude Code CLI (codegen only) |
| `OSKI_CRON_ENABLED` | no | Enable the example recurring jobs (default `false`) |
| `OSKI_HEARTBEAT_ENABLED` | no | Daily "I'm online" Slack post (default `false`) |
| `OSKI_TIMEZONE` | no | IANA timezone for the system prompt clock (default `UTC`) |

## How tools work

A tool is one file:

```ts
import type { ToolDefinition } from '../../tool-registry';

const tool: ToolDefinition = {
  name: 'check_weather',            // snake_case, unique
  description: 'Get the current weather for a city.',
  scope: 'read',                    // read | draft | live
  inputSchema: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name.' },
    },
    required: ['city'],
  },
  async run({ city }) {
    // Return errors as values, never throw.
    return { city, forecast: 'sunny' };
  },
};

export default tool;
```

Drop it in `src/tools/builtin/`, restart, done. Scope semantics:

- `read` — no side effects, always runs.
- `draft` — produces the artifact (message text, email body) but does not send unless the tool's name is in `OSKI_LIVE_TOOLS`.
- `live` — side-effectful. Use sparingly and audit carefully.

## Safety model

1. **Draft-first.** Outbound actions return draft text for human review by default. Going live requires adding the tool name to `OSKI_LIVE_TOOLS` — a deliberate, per-tool decision.
2. **Deny-by-default file access.** `read_file` and `search_code` only touch directories in `OSKI_WORKSPACE_ROOTS`. No roots configured means no access. Symlinks are resolved and re-checked so they cannot escape the sandbox.
3. **No shell interpolation.** `search_code` invokes ripgrep via `execFile` with an argument array. Model-supplied input is never concatenated into a shell string.
4. **Hard budget.** The queue pauses when the daily USD cap is reached. Unknown models are priced at the most expensive tier so the cap errs toward pausing early.
5. **Codegen is opt-in and experimental.** `generate_tool` refuses to run unless `OSKI_ENABLE_CODEGEN=true`. Generated tools load at `read` scope, but they are real code running with full process permissions: **always read a generated tool before keeping it, and never add one to `OSKI_LIVE_TOOLS` without review.**
6. **Audit trails.** Task queue, cost, and instruction edits each get an append-only JSONL log under `data/agent/`.

## Adding a custom tool

1. Copy an existing file in `src/tools/builtin/` as a template.
2. Keep the scope at `read` unless it genuinely needs to write.
3. Catch every error and return `{ error: string }` — never throw.
4. Restart the agent and run `oski tools` (Slack) or `npm run agent:task -- "list your loaded tools"` to confirm it loaded.

Riskier integrations (email, databases) live in [examples/plugins/](examples/plugins/) with placeholder-only setup instructions. They are not loaded by default.

## What is intentionally not included

- **No autonomous sending.** There is no path to send email from this repo; the email example only creates drafts.
- **No production database writes.** The database example is SELECT-only against a role you create with read-only grants.
- **No memory of your company baked in.** `instructions.md` ships generic. Your team's rules accumulate through `oski learn:`.
- **No multi-tenant anything.** One agent, one team, one channel. That's the point.

## License

MIT — see [LICENSE](LICENSE).
