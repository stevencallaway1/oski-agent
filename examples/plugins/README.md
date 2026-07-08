# Example plugins

These tools are **not loaded by default**. They integrate with external services
(email, databases) and carry more risk than the built-ins, so they live here as
reference implementations with placeholder-only configuration.

## How to enable one

1. Read the file top to bottom. Understand exactly what it does.
2. Install its dependency (listed in the file header).
3. Copy it into `src/tools/builtin/`.
4. Add the required env vars to your `.env` (placeholders are in each file header).
5. Restart the agent. The registry loads it automatically.

## Included examples

| File | What it does | Extra dependency |
|---|---|---|
| `email_draft.ts` | Creates a Gmail draft (never sends) via Google OAuth | `googleapis` |
| `query_postgres_ro.ts` | Read-only SELECT queries against a Postgres database | `pg`, `@types/pg` |

## Safety notes

- `email_draft.ts` only creates drafts. Sending always requires manual action in Gmail. Still, an OAuth token with Gmail scope is sensitive. Store it in `.env` only, never commit it.
- `query_postgres_ro.ts` expects a **dedicated read-only database role**. Do not point it at a connection string with write privileges; the regex guard inside the tool is defense-in-depth, not the primary control. Create a role with `GRANT SELECT` only.
- Anything the model can read can end up in a reply. Do not connect these tools to data sources containing customer PII unless every person reading the Slack channel is cleared to see that data.
