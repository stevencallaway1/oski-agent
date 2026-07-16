# Contributing

Thanks for your interest in improving Oski.

## Ground rules

- Keep the safety model intact. PRs that weaken draft-first defaults, widen file access, or bypass the live-tools allowlist will not be merged.
- One tool = one file. Tools export a default `ToolDefinition`, catch every error, and return `{ error: string }` instead of throwing.
- New tools default to `scope: 'read'`. Justify anything else in the PR description.
- TypeScript strict mode. No `any`.
- No new runtime dependencies without a good reason. The dependency surface is deliberately small.
- Oski is a reference architecture for one small team, not a production multi-tenant platform.
- Generated tools are untrusted code and must be reviewed before they are trusted.
- Behavioral and security claims in code, docs, and examples must continue to match the implementation.

## Dev setup

Node.js 20 or newer is required.

```bash
npm install
npm run demo
npm run build
npm test
```

The demo uses a deterministic mock model and does not require an API key. Copy `.env.example` to `.env` only when exercising a real model or integration.

## Submitting changes

1. Fork the repository, create a focused branch, and make your change.
2. Run `npm run demo`, `npm run build`, and `npm test` as relevant. The PR must compile cleanly.
3. Add tests for behavior changes and update docs when public behavior changes.
4. If you touched anything security-relevant (file access, exec, live tools), call it out explicitly.
5. Open a pull request with a clear summary and verification notes.

## Reporting bugs

Open an issue with the requested details and sanitized logs. Never include secrets, tokens, production data, or private company information in issues, examples, or pull requests. For security issues, see [SECURITY.md](SECURITY.md) and do not open a public issue.
