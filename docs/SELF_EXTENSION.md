# Self-Evolution Model

"Self-evolving" is a strong claim. This document defines exactly what it means in this repo, and what it does not mean.

Oski evolves in two ways:

1. **Behavioral evolution.** The agent's behavior changes through `instructions.md`, updated from plain-English feedback via `oski learn:`.
2. **Capability evolution.** The agent's tool surface can grow through `generate_tool`, which scaffolds a new TypeScript tool file when the agent hits a capability gap.

Neither path changes trust automatically. A learned rule can shift tone or process, not grant new permissions. A generated tool is a proposal, not a deployment. Anything with side effects still requires a human to approve it.

## Why a static tool set is not enough

A fixed tool list decided at deploy time works fine for a narrow assistant. It breaks down for an internal ops agent, because the tasks a small team wants automated are open-ended and change over time. "Check the deploy status," "look up who's on call," and "summarize the CI failures" are all things a team might want this week that nobody wrote a tool for last week.

The common fixes both have tradeoffs. Give the model a general code-execution tool and every safety boundary in the rest of Oski becomes harder to reason about. Require a developer to ship every new tool as a PR before the agent can use it and capability only grows at the speed of a release cycle.

Oski sits between those two approaches. The agent can propose a new tool as a real, reviewable file. That file does not get to act with side effects until a human has looked at it.

## How generated tools work

When `OSKI_ENABLE_CODEGEN=true` and the agent calls `generate_tool` with a name and a plain-language spec:

1. A scaffold `ToolDefinition` file is written to `src/tools/generated/<name>.ts`. A valid but non-functional stub is created first, so there is always a concrete file on disk even if generation fails partway.
2. The Claude Code CLI runs as a child process (`execFile`, argument array, no shell interpolation) with a prompt containing the spec and the rules: implement the scaffold fully, keep `scope: 'read'` unless the spec genuinely requires more, catch every error and return `{ error: string }` instead of throwing, stay under 80 lines, TypeScript strict mode.
3. The tool registry's filesystem watcher on `src/tools/generated/` picks up the finished file and hot-reloads it. No restart needed to make it callable.
4. Generation is capped at 3 calls/day (`POLICY.dailyGenerateToolCap`), independent of the daily USD spend cap.

## Why generated tools are off by default

`OSKI_ENABLE_CODEGEN` defaults to `false`. Turning it on means the agent can write and load real TypeScript that runs with the same process permissions as the rest of Oski. There is no container or sandbox around this generation step today. See [ARCHITECTURE.md](ARCHITECTURE.md#optional-codegen-self-evolution). That is a meaningfully different risk profile from every other tool in this repo, which is why it needs an explicit, separate opt-in rather than being bundled with normal tool use.

## Why human review matters

A generated file loading at `read` scope is a convention the prompt asks the CLI to follow. It is not something the runtime forcibly restricts the generated code to. A generated tool is, functionally, a pull request from a fast but unsupervised contributor. It might be exactly right. It might be subtly wrong. Until a person reads it, nobody knows which. That is why:

- Generated tools are never automatically added to `OSKI_LIVE_TOOLS`. Even if the generated code declares `scope: 'live'`, the runtime does not treat that as trusted for anything side-effectful until a human opts it in.
- The recommended workflow (see [CONTRIBUTING.md](../CONTRIBUTING.md)) is to review the file, then either delete it, fix it, or promote it into `src/tools/builtin/` once it is trusted. Generated tools are a staging area, not a permanent home.

## How this differs from fixed function calling

Fixed function calling gives a model a tool surface decided entirely at deploy time. Unrestricted code-execution agents go the other direction: the model can run arbitrary code with no fixed surface and no review gate before execution.

Oski's self-evolution loop sits between those. The tool surface can grow, but growth is capped (3/day), logged (every generation is a normal tool call in the cost log), file-based (each new capability is a diffable, readable file, not ephemeral code execution), and gated by human review before anything it writes can act with side effects.

The agent can propose new capability. It cannot grant itself trust.

## How teams can safely grow an agent over time

A reasonable adoption path:

1. Start with builtins only (`OSKI_ENABLE_CODEGEN=false`, the default). Get comfortable with draft-first behavior and the cost log.
2. Turn on codegen in a development environment, not against your real Slack workspace or real file access.
3. Treat every file that lands in `src/tools/generated/` like a PR from a new contributor. Read it fully before trusting it.
4. Once a generated tool proves itself, either move it into `src/tools/builtin/` as a normal reviewed tool, or leave it in `generated/` at `read` scope if it does not need to do more than that.
5. Only add a tool name to `OSKI_LIVE_TOOLS` after watching its draft output for a while and trusting it unattended.

This keeps the growth of the agent's capabilities on the same footing as any other code change to a system a team depends on: reviewed, incremental, and reversible.
