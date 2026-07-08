import type { ToolDefinition } from '../../src/tool-registry';

// EXAMPLE PLUGIN — not loaded by default. See examples/plugins/README.md.
//
// Runs read-only SELECT queries against a Postgres database.
//
// Requires: npm install pg && npm install -D @types/pg
// Env var (placeholder only):
//   POSTGRES_RO_URL=postgresql://readonly_user:password@host:5432/dbname
//
// IMPORTANT: create a dedicated database role with SELECT-only grants and use
// that role's connection string. The regex guard below is defense-in-depth,
// not the primary control.

const WRITE_PATTERN = /^\s*(insert|update|delete|drop|alter|create|truncate|grant|revoke|begin|commit|rollback)/i;

const tool: ToolDefinition = {
  name: 'query_postgres_ro',
  description: 'Run a read-only SELECT query against the configured Postgres database. No writes, inserts, or schema changes. Returns up to 50 rows.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'A SELECT SQL query.' },
    },
    required: ['sql'],
  },
  async run({ sql }) {
    const roUrl = process.env.POSTGRES_RO_URL;
    if (!roUrl) {
      return { error: 'POSTGRES_RO_URL is not configured. Set it in .env to enable database queries.' };
    }

    if (WRITE_PATTERN.test(String(sql))) {
      return { error: 'Only SELECT queries are permitted.' };
    }

    const pg = await import('pg');
    const client = new pg.Client({ connectionString: roUrl });
    try {
      await client.connect();
      const result = await client.query({ text: String(sql), rowMode: 'array' });
      const fields = result.fields.map(f => f.name);
      const rows = result.rows.slice(0, 50);
      return { fields, rows, count: rows.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      await client.end().catch(() => {});
    }
  },
};

export default tool;
