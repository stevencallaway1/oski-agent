import type { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import { enqueue } from '../queue';

// Slack Events API handler (HTTP fallback when Socket Mode is not used).
// Verifies the request signature using OSKI_SLACK_SIGNING_SECRET.

function getSigningSecret(): string {
  return process.env.OSKI_SLACK_SIGNING_SECRET ?? '';
}

export function validateSlackSignature(input: {
  secret: string;
  timestamp: string;
  signature: string;
  rawBody: string;
  nowMs?: number;
}): boolean {
  const timestampNumber = Number.parseInt(input.timestamp, 10);
  if (!input.secret || !Number.isFinite(timestampNumber)) return false;
  if (Math.abs((input.nowMs ?? Date.now()) / 1000 - timestampNumber) > 300) return false;

  const computed = 'v0=' + crypto
    .createHmac('sha256', input.secret)
    .update(`v0:${input.timestamp}:${input.rawBody}`)
    .digest('hex');
  const expected = Buffer.from(computed);
  const supplied = Buffer.from(input.signature);
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function verifySlackSignature(req: Request): boolean {
  const secret = getSigningSecret();
  if (!secret) {
    console.warn('[oski:slack] OSKI_SLACK_SIGNING_SECRET not set - skipping signature check (dev mode only)');
    return true;
  }

  const ts = req.headers['x-slack-request-timestamp'];
  const sig = req.headers['x-slack-signature'];
  if (!ts || !sig || typeof ts !== 'string' || typeof sig !== 'string') return false;

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? JSON.stringify(req.body);
  return validateSlackSignature({ secret, timestamp: ts, signature: sig, rawBody });
}

export function createSlackEventsRouter(): Router {
  const router = express.Router();

  // Slack sends raw JSON; we need the raw body for signature verification.
  router.use(express.json({
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }));

  router.post('/', (req: Request, res: Response) => {
    if (!verifySlackSignature(req)) {
      res.status(401).json({ error: 'invalid signature' });
      return;
    }

    const body = req.body as Record<string, unknown>;

    // Slack URL verification challenge.
    if (body.type === 'url_verification') {
      res.json({ challenge: body.challenge });
      return;
    }

    if (body.type !== 'event_callback') {
      res.sendStatus(200);
      return;
    }

    const event = body.event as Record<string, unknown> | undefined;
    if (!event) { res.sendStatus(200); return; }

    // Only handle message events (not bot messages, to avoid echo loops).
    if (event.type !== 'message') { res.sendStatus(200); return; }
    if (event.bot_id || event.subtype) { res.sendStatus(200); return; }

    const text = String(event.text ?? '').trim();
    const channel = String(event.channel ?? '');
    const user = String(event.user ?? '');
    const slackTs = String(event.ts ?? '');
    const threadTs = event.thread_ts ? String(event.thread_ts) : undefined;

    // Respond immediately - Slack requires <3s.
    res.sendStatus(200);

    // Only process messages that mention oski or are in the designated channel.
    const oskiChannel = process.env.OSKI_SLACK_CHANNEL_ID ?? '';
    const mentionsOski = text.toLowerCase().includes('oski');
    if (!mentionsOski && channel !== oskiChannel) return;

    // Strip the "oski:" or "@oski" prefix for cleaner task text.
    const cleaned = text.replace(/^oski:/i, '').replace(/<@[A-Z0-9]+>/g, '').trim();
    if (!cleaned) return;

    console.log(`[oski:slack] inbound from ${user} in ${channel}: ${cleaned.slice(0, 80)}`);
    enqueue(cleaned, 'slack', { channel, user, slackTs, threadTs });
  });

  return router;
}
