# Oski Slack Setup Guide

*How to connect Oski to your Slack workspace. Estimated time: 15 minutes.*

---

## Why Socket Mode

Oski uses Socket Mode instead of the HTTP Events API. This means:

- No public URL required — works locally without ngrok.
- No signature verification complexity.
- Works on any host with outbound internet, no inbound webhook configuration.
- Slack maintains a persistent WebSocket to your server and reconnects automatically.

The only tradeoff: Socket Mode requires a long-running process with an active connection. If you can only run a stateless HTTP endpoint, use the Events API fallback (set `OSKI_SLACK_SIGNING_SECRET` and leave `OSKI_SLACK_APP_TOKEN` blank).

---

## Step 1: Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps).
2. Click **Create New App** → **From scratch**.
3. Name: `Oski` (or anything you like).
4. Select your workspace and click **Create App**.

---

## Step 2: Enable Socket Mode

1. In the left sidebar, click **Socket Mode**.
2. Toggle **Enable Socket Mode** to ON.
3. You will be prompted to create an **App-Level Token**.
4. Name it `oski-socket-token` and add the scope `connections:write`.
5. Click **Generate** and copy the token — it starts with `xapp-`.
6. Add it to your `.env` as `OSKI_SLACK_APP_TOKEN=xapp-...`.

---

## Step 3: Add Bot Scopes

1. In the left sidebar, click **OAuth & Permissions**.
2. Scroll to **Bot Token Scopes** and add:

| Scope | Why |
|---|---|
| `app_mentions:read` | Receive @Oski mentions |
| `chat:write` | Post messages |
| `channels:history` | Read public channel messages (thread memory) |
| `channels:read` | List channels and get channel info |
| `groups:history` | Read private channel messages |
| `groups:read` | List private channels |
| `users:read` | Look up user display names |

---

## Step 4: Subscribe to Events

1. In the left sidebar, click **Event Subscriptions** and toggle **Enable Events** to ON.
2. Under **Subscribe to bot events**, add:
   - `message.channels` — messages in public channels
   - `message.groups` — messages in private channels
   - `app_mention` — @Oski mentions in any channel
3. Click **Save Changes**.

With Socket Mode enabled you do NOT need a Request URL — events arrive over the WebSocket.

---

## Step 5: Install the App to Your Workspace

1. Under **OAuth & Permissions**, click **Install to Workspace** and approve.
2. Copy the **Bot User OAuth Token** — it starts with `xoxb-`.
3. Add it to your `.env` as `OSKI_SLACK_BOT_TOKEN=xoxb-...`.

---

## Step 6: Create the Agent Channel

1. In Slack, create a channel for the agent (e.g. `#oski`). Private is recommended.
2. Invite the bot: type `/invite @Oski` in the channel.
3. Get the channel ID: right-click the channel name → **View channel details** → the ID is at the bottom (starts with `C`).
4. Add it to your `.env` as `OSKI_SLACK_CHANNEL_ID=C...`.

Important: the bot receives message events from every channel it is a member of. Keeping it in exactly one channel is the simplest way to control its inputs.

---

## Step 7: Configure .env

Your `.env` should now include:

```bash
ANTHROPIC_API_KEY=...
OSKI_SLACK_APP_TOKEN=xapp-1-...
OSKI_SLACK_BOT_TOKEN=xoxb-...
OSKI_SLACK_CHANNEL_ID=C...
OSKI_WORKSPACE_ROOTS=/path/to/dir/the/agent/may/read
OSKI_DAILY_USD_CAP=2
OSKI_LIVE_TOOLS=            # leave empty for draft-only mode
```

---

## Step 8: Run

```bash
npm run dev
```

You should see:

```
[oski:slack] Socket Mode connected to Slack
[oski] online — 5 tools loaded. All actions are draft-only.
```

In the agent channel, type:

```
oski help
```

If Oski replies with its command list, you're done.

---

## Troubleshooting

- **No reply at all** — check the bot is actually a member of the channel (`/invite @Oski`), and that `message.channels` / `message.groups` events are subscribed.
- **"scope or channel check failed" in logs** — add `channels:history` (public) or `groups:history` (private) and reinstall the app.
- **Replies but no thread memory** — same as above; thread history needs the history scopes.
- **`invalid_auth`** — the bot token was regenerated in Slack; copy the new `xoxb-` value into `.env` and restart.
