import { getSql, rows } from "./db";

let ready = false;

async function columns(table: string): Promise<Set<string>> {
  const sql = getSql();
  if (!sql) return new Set();
  const found = rows<{ column_name: string }>(
    await sql`SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = ${table}`,
  );
  return new Set(found.map((r) => r.column_name));
}

/** Create the journal tables and upgrade a watchlist that still has one row per symbol. */
export async function ensureSchema(): Promise<void> {
  const sql = getSql();
  if (!sql || ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS watchlist (
      id                TEXT PRIMARY KEY,
      symbol            TEXT NOT NULL,
      saved_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      plan_date         DATE,
      active            INTEGER NOT NULL DEFAULT 1,
      role              TEXT NOT NULL DEFAULT 'saved',
      original_payload  JSONB NOT NULL,
      verdict           TEXT,
      verdict_reason    TEXT,
      verdict_at        TIMESTAMPTZ,
      triggered         INTEGER NOT NULL DEFAULT 0
    )`;
  const watch = await columns("watchlist");
  if (watch.size && !watch.has("id")) {
    await sql`ALTER TABLE watchlist ADD COLUMN id TEXT`;
    await sql`ALTER TABLE watchlist ADD COLUMN active INTEGER NOT NULL DEFAULT 1`;
    await sql`ALTER TABLE watchlist ADD COLUMN role TEXT NOT NULL DEFAULT 'saved'`;
    await sql`ALTER TABLE watchlist ADD COLUMN original_payload JSONB`;
    await sql`ALTER TABLE watchlist ADD COLUMN verdict TEXT`;
    await sql`ALTER TABLE watchlist ADD COLUMN verdict_reason TEXT`;
    await sql`ALTER TABLE watchlist ADD COLUMN verdict_at TIMESTAMPTZ`;
    await sql`ALTER TABLE watchlist ADD COLUMN triggered INTEGER NOT NULL DEFAULT 0`;
    await sql`UPDATE watchlist SET id = symbol WHERE id IS NULL`;
    if (watch.has("payload")) {
      await sql`UPDATE watchlist SET original_payload = payload WHERE original_payload IS NULL`;
    }
    await sql`ALTER TABLE watchlist DROP CONSTRAINT IF EXISTS watchlist_pkey`;
    await sql`ALTER TABLE watchlist ALTER COLUMN id SET NOT NULL`;
    await sql`ALTER TABLE watchlist ALTER COLUMN original_payload SET NOT NULL`;
    await sql`ALTER TABLE watchlist ADD PRIMARY KEY (id)`;
  }
  if (watch.has("payload")) {
    await sql`ALTER TABLE watchlist DROP COLUMN IF EXISTS payload`;
  }
  await sql`CREATE INDEX IF NOT EXISTS watchlist_symbol_idx ON watchlist (symbol)`;

  const alerts = await columns("alerts");
  if (alerts.size && !alerts.has("plan_id")) {
    await sql`ALTER TABLE alerts ADD COLUMN plan_id TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_pkey`;
    await sql`ALTER TABLE alerts ADD PRIMARY KEY (day, symbol, condition, plan_id)`;
  }

  const positions = await columns("positions");
  if (positions.size && !positions.has("plan_id")) await sql`ALTER TABLE positions ADD COLUMN plan_id TEXT`;
  if (positions.size && !positions.has("original_plan")) await sql`ALTER TABLE positions ADD COLUMN original_plan JSONB`;
  if (positions.size && !positions.has("stance")) await sql`ALTER TABLE positions ADD COLUMN stance TEXT`;
  if (positions.size && !positions.has("stance_reason")) await sql`ALTER TABLE positions ADD COLUMN stance_reason TEXT`;
  if (positions.size && !positions.has("stance_at")) await sql`ALTER TABLE positions ADD COLUMN stance_at TIMESTAMPTZ`;
  ready = true;
}
