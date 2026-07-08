# Release / Publication Checklist

Run this before every public release or any push to a public remote. All boxes must be checked.

## Secrets

- [ ] No real secrets anywhere in the repo: `git grep -iE "xoxb-|xapp-|sk-ant|api[_-]?key\s*=\s*['\"][A-Za-z0-9]" -- ':!docs' ':!*.md'` returns nothing (token *prefixes* in docs as format examples are OK; real values are never OK)
- [ ] `.env` is not tracked: `git ls-files | grep -x ".env"` returns nothing
- [ ] `.env.example` contains placeholders only — every value is empty or an obvious dummy
- [ ] No OAuth tokens, refresh tokens, connection strings, or service-role keys in code, comments, or logs
- [ ] No hardcoded tokens in test fixtures or example files

## Company / personal information

- [ ] No company names, product names, or internal project codenames from any private workspace
- [ ] No employee, founder, customer, or investor names or email addresses
- [ ] No customer or user data of any kind
- [ ] No private strategy: pricing, pipeline, fundraising, deal names, internal metrics
- [ ] No private URLs (internal dashboards, staging hosts, company domains)
- [ ] `LICENSE` copyright line says what you want it to say

## Sweep commands

```bash
# From the repo root — should return nothing (adjust the list to your own private terms):
grep -rniE "your-company|your-name|internal-codename|staging\.|\.internal" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=data .

# Confirm nothing sensitive is tracked:
git ls-files | grep -E "\.env$|\.pem$|\.key$|credentials"
```

## Quality gates

- [ ] `npm install` succeeds on a clean clone
- [ ] `npm run build` passes with zero errors
- [ ] Tests pass, if present
- [ ] `npm run agent:task -- "list your loaded tools"` runs end to end with a valid API key
- [ ] README setup steps verified on a machine (or clean directory) that has never run the project
- [ ] `data/` directory is empty or absent in the repo (runtime logs are gitignored)
- [ ] `src/tools/generated/` contains only `.gitkeep`

## Final

- [ ] `git log` messages contain no private context (squash if needed — better yet, publish from a fresh history)
- [ ] Repo description and topics on GitHub contain no private context
