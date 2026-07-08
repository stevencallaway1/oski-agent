# The self-extension pattern

This document explains the reasoning behind `generate_tool`, why it's off by default, and how it differs from just giving a model a code execution sandbox.

## Why a static tool set is not enough

A fixed tool list decided at deploy time works fine for a narrow assistant. It breaks down for an internal ops agent, because the tasks a small team wants automated are open-ended and change over time — "check the deploy status," "look up who's on call," "summarize the CI failures" are all things a team might want this week that nobody wrote a tool for last week.

The naive fixes are both bad:
- Give the model a general code-execution tool and let it write and run arbitrary code inline. This collapses every safety boundary the rest of Oski is built around — there's no review step, no scope, no audit trail for what the code actually does before it runs.
- Require a human developer to write and ship every new tool as a PR before the agent can ever use it. This is safe, but it means the agent's capability set only grows at the speed of your release cycle, not the speed of the team hitting a gap.

Oski's answer is a middle path: the agent can propose a new tool as a real, reviewable file — but that file does not get to act with side effects until a human has actually looked at it.

## How generated tools work

When `OSKI_ENABLE_CODEGEN=true` and the agent calls `generate_tool` with a name and a plain-language spec:

1. A scaffold `ToolDefinition` file is written to `src/tools/generated/<name>.ts` — a valid but non-functional stub, so there's always a concrete file on disk even if generation fails partway.
2. The Claude Code CLI is invoked as a child process (`execFile`, argument array — no shell interpolation) with a prompt containing the spec and the rules: implement the scaffold fully, keep `scope: 'read'` unless the spec genuinely requires more, catch every error and return `{ error: string }` instead of throwing, stay under 80 lines, TypeScript strict mode.
3. The tool registry's filesystem watcher on `src/tools/generated/` picks up the finished file and hot-reloads it — no restart needed to make it callable.
4. Generation is capped at 3 calls/day (`POLICY.dailyGenerateToolCap`), independent of the daily USD spend cap.

## Why generated tools are off by default

`OSKI_ENABLE_CODEGEN` defaults to `false`. Turning it on means the agent can write and load real TypeScript that runs with the same process permissions as the rest of Oski — there is no container or sandbox around this generation step today (see [ARCHITECTURE.md](ARCHITECTURE.md#optional-codegen-self-extension)). That's a meaningfully different risk profile from every other tool in this repo, which is why it needs an explicit, separate opt-in rather than being bundled with normal tool use.

## Why human review matters

A generated file loading at `read` scope is a convention the prompt asks the CLI to follow — it is not something the runtime forcibly restricts the generated code to. A generated tool is, functionally, a pull request from a fast but unsupervised contributor: it might be exactly right, it might be subtly wrong, and until a person has read it, nobody actually knows which. That's why:

- Generated tools are never automatically added to `OSKI_LIVE_TOOLS`. Even if the generated code declares `scope: 'live'`, the runtime does not treat that as trusted for anything side-effectful until a human opts it in.
- The recommended workflow (see [CONTRIBUTING.md](../CONTRIBUTING.md)) is to review the file, then either delete it, fix it, or promote it into `src/tools/builtin/` once it's trusted — generated tools are a staging area, not a permanent home.

## How this differs from naive function calling

Naive function calling gives a model a fixed set of functions decided entirely at deploy time — the tool surface is static, full stop. Unrestricted code-execution agents go the other direction — the model can run arbitrary code with no fixed surface and no review gate at all.

Oski's self-extension pattern sits between those: the tool surface can grow, but growth is capped (3/day), logged (every generation is a normal tool call in the cost log), file-based (each new capability is a diffable, readable file, not an ephemeral code execution), and gated by human review before anything it writes can act with side effects. The agent can *propose* new capability. It cannot *grant itself* trust.

## How teams can safely grow an agent over time

A reasonable adoption path:

1. Start with builtins only (`OSKI_ENABLE_CODEGEN=false`, the default). Get comfortable with draft-first behavior and the cost log.
2. Turn on codegen in a development environment, not against your real Slack workspace or real file access.
3. Treat every file that lands in `src/tools/generated/` exactly like a PR from a new contributor — read it fully before trusting it.
4. Once a generated tool proves itself, either move it into `src/tools/builtin/` as a normal reviewed tool, or leave it in `generated/` at `read` scope if it doesn't need to do more than that.
5. Only add a tool name to `OSKI_LIVE_TOOLS` after you've watched its draft output for a while and are comfortable trusting it unattended.

This keeps the growth of the agent's capabilities on the same footing as any other code change to a system your team depends on — reviewed, incremental, and reversible.
