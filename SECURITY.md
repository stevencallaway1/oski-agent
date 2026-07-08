# Security Policy

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security tab → "Report a vulnerability") rather than filing a public issue. Include reproduction steps and impact. You should receive a response within a week.

## Threat model

Oski executes model-chosen tool calls against your local machine and your Slack workspace. The main risks and the controls that address them:

| Risk | Control |
|---|---|
| Prompt injection via file contents or Slack messages steering the agent | Draft-first: side-effectful tools return drafts unless explicitly allowlisted in `OSKI_LIVE_TOOLS` |
| Reading files it shouldn't | Deny-by-default: `read_file`/`search_code` require `OSKI_WORKSPACE_ROOTS`; symlinks resolved and re-checked |
| Command injection through search queries | `execFile` with argument arrays; no shell string interpolation anywhere in the tool layer |
| Runaway API spend | `OSKI_DAILY_USD_CAP` pauses the queue; unknown models priced at the most expensive tier |
| Self-authored code doing something malicious or broken | Codegen off by default (`OSKI_ENABLE_CODEGEN`); generated tools load at `read` scope and require human review |
| Forged Slack webhooks (HTTP fallback mode) | HMAC signature verification with timestamp replay window |

## Operator responsibilities

Controls in the repo only work if the deployment is sane:

- Never commit `.env`. The `.gitignore` covers it; keep it that way.
- Point `OSKI_WORKSPACE_ROOTS` only at directories you would paste into a chat with your whole team. Everything readable can end up in a Slack reply.
- Keep `OSKI_LIVE_TOOLS` empty until you have watched the agent's drafts for a while.
- If you enable an example plugin, follow its README: read-only database roles, draft-only email scopes.
- Review everything in `src/tools/generated/` before keeping it. Treat generated code like a pull request from a stranger.

## Scope

This policy covers the code in this repository. Vulnerabilities in dependencies (Anthropic SDK, Slack SDKs, Express) should be reported upstream.
