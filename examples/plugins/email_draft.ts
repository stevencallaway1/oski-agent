import type { ToolDefinition } from '../../src/tool-registry';

// EXAMPLE PLUGIN — not loaded by default. See examples/plugins/README.md.
//
// Creates a Gmail draft via the Google API using an OAuth token you provide.
// Never sends — only drafts. Sending requires manual action in Gmail.
//
// Requires: npm install googleapis
// Env vars (placeholders only — get real values from Google Cloud Console):
//   GOOGLE_CLIENT_ID=your_client_id_here
//   GOOGLE_CLIENT_SECRET=your_client_secret_here
//   GOOGLE_ACCESS_TOKEN=
//   GOOGLE_REFRESH_TOKEN=

const tool: ToolDefinition = {
  name: 'email_draft',
  description: 'Create a Gmail draft. The email is saved to the Drafts folder and NOT sent. A human must open Gmail and send it manually.',
  scope: 'draft',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address.' },
      subject: { type: 'string', description: 'Email subject line.' },
      body: { type: 'string', description: 'Email body in plain text.' },
    },
    required: ['to', 'subject', 'body'],
  },
  async run({ to, subject, body }) {
    try {
      const { google } = await import('googleapis');
      const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
      const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      if (!accessToken && !refreshToken) {
        return {
          mode: 'draft',
          note: 'Google OAuth not configured. Draft contents below for manual copy-paste.',
          to, subject, body,
        };
      }

      const auth = new google.auth.OAuth2(clientId, clientSecret);
      auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

      const gmail = google.gmail({ version: 'v1', auth });

      const messageParts = [
        `To: ${to}`,
        `Subject: ${subject}`,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        body,
      ];
      const raw = Buffer.from(messageParts.join('\r\n')).toString('base64url');

      const draft = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw } },
      });

      return {
        mode: 'draft_created',
        draft_id: draft.data.id,
        note: `Draft created in Gmail. Review and send from the Drafts folder. To: ${to}`,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export default tool;
