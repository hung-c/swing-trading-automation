import { asDate, asObj, first, getSql, rows } from "./db";
import type { PlanCard, WatchItem } from "./types";

const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

let tableReady = false;

export async function ensureWatchlist(): Promise<void> {
  const sql = getSql();
  if (!sql || tableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS watchlist (
      symbol     TEXT PRIMARY KEY,
      saved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      plan_date  DATE,
      payload    JSONB NOT NULL
    )`;
  tableReady = true;
}

function stamp(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return v == null ? "" : String(v);
}

export async function loadWatchlist(): Promise<WatchItem[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    await ensureWatchlist();
    const raw = await sql`
      SELECT symbol, saved_at, plan_date, payload
      FROM watchlist
      ORDER BY saved_at, symbol`;
    return rows<Record<string, unknown>>(raw).map((r) => ({
      symbol: String(r.symbol),
      savedAt: stamp(r.saved_at),
      planDate: r.plan_date ? asDate(r.plan_date) : null,
      plan: asObj<PlanCard>(r.payload),
    }));
  } catch (e) {
    console.error("loadWatchlist", e);
    return [];
  }
}

export async function saveWatch(symbolRaw: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const sql = getSql();
  if (!sql) return { ok: false, error: "DATABASE_URL missing", status: 500 };
  const symbol = symbolRaw.toUpperCase().trim();
  if (!SYMBOL_RE.test(symbol)) return { ok: false, error: "Enter a ticker symbol", status: 400 };
  await ensureWatchlist();
  const found = first<{ plan_date: unknown; payload: unknown }>(
    await sql`
      SELECT plan_date, payload FROM plans
      WHERE symbol = ${symbol}
      ORDER BY plan_date DESC
      LIMIT 1`,
  );
  if (!found) {
    return { ok: false, error: `${symbol} has no plan card to save`, status: 404 };
  }
  const plan = asObj<PlanCard>(found.payload);
  if (plan.status === "rejected") {
    return { ok: false, error: `${symbol} was rejected, so it stays off the watchlist`, status: 400 };
  }
  const payload = JSON.stringify(plan);
  const planDate = asDate(found.plan_date);
  await sql`
    INSERT INTO watchlist (symbol, saved_at, plan_date, payload)
    VALUES (${symbol}, now(), ${planDate}, ${payload}::jsonb)
    ON CONFLICT (symbol) DO UPDATE SET
      plan_date = excluded.plan_date,
      payload = excluded.payload`;
  return { ok: true };
}

export async function deleteWatch(symbolRaw: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const sql = getSql();
  if (!sql) return { ok: false, error: "DATABASE_URL missing", status: 500 };
  const symbol = symbolRaw.toUpperCase().trim();
  if (!SYMBOL_RE.test(symbol)) return { ok: false, error: "Enter a ticker symbol", status: 400 };
  await ensureWatchlist();
  const existing = first(await sql`SELECT symbol FROM watchlist WHERE symbol = ${symbol} LIMIT 1`);
  if (!existing) return { ok: false, error: `${symbol} is not on the watchlist`, status: 404 };
  await sql`DELETE FROM watchlist WHERE symbol = ${symbol}`;
  return { ok: true };
}
