import { asObj, first, getSql, rows } from "./db";
import { normalizeStrategy, type Strategy, type StrategyStatus } from "./strategy";

export type StrategyRecord = {
  id: string;
  name: string;
  status: StrategyStatus;
  createdAt: string;
  updatedAt: string;
  strategy: Strategy;
};

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let tableReady = false;

async function ensureTable(): Promise<void> {
  const sql = getSql();
  if (!sql || tableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS strategies (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'draft',
      payload    JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  tableReady = true;
}

function stamp(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function mapRow(r: Record<string, unknown>): StrategyRecord | null {
  const parsed = normalizeStrategy(asObj<unknown>(r.payload));
  if (!parsed.ok) return null;
  return {
    id: String(r.id),
    name: parsed.strategy.profile.name,
    status: parsed.strategy.profile.status,
    createdAt: stamp(r.created_at),
    updatedAt: stamp(r.updated_at),
    strategy: parsed.strategy,
  };
}

export async function loadStrategies(): Promise<{ configured: boolean; strategies: StrategyRecord[] }> {
  const sql = getSql();
  if (!sql) return { configured: false, strategies: [] };
  await ensureTable();
  const raw = await sql`SELECT id, name, status, payload, created_at, updated_at FROM strategies ORDER BY updated_at DESC`;
  const strategies = rows<Record<string, unknown>>(raw).flatMap((r) => {
    const row = mapRow(r);
    return row ? [row] : [];
  });
  return { configured: true, strategies };
}

export async function loadStrategy(id: string): Promise<StrategyRecord | null> {
  if (!ID_RE.test(id)) return null;
  const sql = getSql();
  if (!sql) return null;
  await ensureTable();
  const raw = await sql`SELECT id, name, status, payload, created_at, updated_at FROM strategies WHERE id = ${id} LIMIT 1`;
  const row = first<Record<string, unknown>>(raw);
  return row ? mapRow(row) : null;
}

export async function saveStrategy(
  id: string | null,
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string; status: number }> {
  const sql = getSql();
  if (!sql) return { ok: false, error: "DATABASE_URL missing", status: 500 };
  const parsed = normalizeStrategy(input);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
  if (id && !ID_RE.test(id)) return { ok: false, error: "Unknown strategy", status: 400 };

  await ensureTable();
  const strategy = parsed.strategy;
  const nextId = id ?? crypto.randomUUID();
  const payload = JSON.stringify(strategy);
  if (id) {
    const existing = first(await sql`SELECT id FROM strategies WHERE id = ${id} LIMIT 1`);
    if (!existing) return { ok: false, error: "Strategy not found", status: 404 };
    await sql`
      UPDATE strategies
      SET name = ${strategy.profile.name},
          status = ${strategy.profile.status},
          payload = ${payload}::jsonb,
          updated_at = now()
      WHERE id = ${id}`;
  } else {
    await sql`
      INSERT INTO strategies (id, name, status, payload)
      VALUES (${nextId}, ${strategy.profile.name}, ${strategy.profile.status}, ${payload}::jsonb)`;
  }
  return { ok: true, id: nextId };
}

export async function deleteStrategy(id: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!ID_RE.test(id)) return { ok: false, error: "Unknown strategy", status: 400 };
  const sql = getSql();
  if (!sql) return { ok: false, error: "DATABASE_URL missing", status: 500 };
  await ensureTable();
  const existing = first(await sql`SELECT id FROM strategies WHERE id = ${id} LIMIT 1`);
  if (!existing) return { ok: false, error: "Strategy not found", status: 404 };
  await sql`DELETE FROM strategies WHERE id = ${id}`;
  return { ok: true };
}
