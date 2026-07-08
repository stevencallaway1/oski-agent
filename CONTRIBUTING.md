# Contributing

Thanks for your interest in improving Oski.

## Ground rules

- Keep the safety model intact. PRs that weaken draft-first defaults, widen file access, or bypass the live-tools allowlist will not be merged.
- One tool = one file. Tools export a default `ToolDefinition`, catch every error, and return `{ error: string }` instead of throwing.
- New tools default to `scope: 'read'`. Justify anything else in the PR description.
- TypeScript strict mode. No `any`.
- No new runtime dependencies without a good reason — the dependency surface is deliberately small.

## Dev setup

```bash
npm install
cp .env.example .env   # add your ANTHROPIC_API_KEY
npm run build          # must pass before any PR
npm run agent:task -- "list your loaded tools"   # smoke test
```

## Submitting changes

1. Fork, branch, and make your change.
2. Run `npm run build` — the PR must compile clean.
3. If you touched a tool, include a sample task and the tool's output in the PR description.
4. If you touched anything security-relevant (file access, exec, live tools), call it out explicitly.

## Reporting bugs

Open an issue with the task text you ran, the expected behavior, and the relevant log lines (redact your tokens and file paths first). For security issues, see [SECURITY.md](SECURITY.md) — do not open a public issue.
