import { randomUUID } from "crypto";
import { asDate, asObj, first, getSql, rows } from "./db";
import { ensureSchema } from "./schema";
import type { PlanCard, WatchItem } from "./types";

const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

function stamp(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return v == null ? "" : String(v);
}

function flag(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-9) <= 0.005;
}

function samePlan(a: PlanCard, b: PlanCard): boolean {
  return a.symbol.toUpperCase() === b.symbol.toUpperCase() && a.pattern === b.pattern && near(a.resistance, b.resistance) && near(a.entry, b.entry) && near(a.stop, b.stop);
}

function mapRow(r: Record<string, unknown>): WatchItem {
  const role = r.role === "candidate" ? "candidate" : "saved";
  const verdict = r.verdict === "still_good" || r.verdict === "out" ? r.verdict : null;
  return {
    id: String(r.id),
    symbol: String(r.symbol),
    savedAt: stamp(r.saved_at),
    planDate: r.plan_date ? asDate(r.plan_date) : null,
    active: flag(r.active),
    role,
    plan: asObj<PlanCard>(r.original_payload),
    verdict,
    verdictReason: r.verdict_reason == null ? null : String(r.verdict_reason),
    verdictAt: r.verdict_at ? stamp(r.verdict_at) : null,
    triggered: flag(r.triggered),
  };
}

export async function loadWatchlist(): Promise<WatchItem[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    await ensureSchema();
    const raw = await sql`
      SELECT id, symbol, saved_at, plan_date, active, role, original_payload,
             verdict, verdict_reason, verdict_at, triggered
      FROM watchlist
      ORDER BY symbol, saved_at, id`;
    return rows<Record<string, unknown>>(raw).map(mapRow);
  } catch (e) {
    console.error("loadWatchlist", e);
    return [];
  }
}

async function latestPlan(symbol: string): Promise<{ plan: PlanCard; planDate: string } | null> {
  const sql = getSql();
  if (!sql) return null;
  const found = first<{ plan_date: unknown; payload: unknown }>(
    await sql`
      SELECT plan_date, payload FROM plans
      WHERE symbol = ${symbol}
      ORDER BY plan_date DESC
      LIMIT 1`,
  );
  if (!found) return null;
  return { plan: asObj<PlanCard>(found.payload), planDate: asDate(found.plan_date) };
}

export async function saveWatch(symbolRaw: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const sql = getSql();
  if (!sql) return { ok: false, error: "DATABASE_URL missing", status: 500 };
  const symbol = symbolRaw.toUpperCase().trim();
  if (!SYMBOL_RE.test(symbol)) return { ok: false, error: "Enter a ticker symbol", status: 400 };
  await ensureSchema();
  const found = await latestPlan(symbol);
  if (!found) return { ok: false, error: `${symbol} has no plan card to save`, status: 404 };
  if (found.plan.status === "rejected") {
    return { ok: false, error: `${symbol} was rejected, so it stays off the watchlist`, status: 400 };
  }
  const existing = rows<Record<string, unknown>>(
    await sql`SELECT id, symbol, active, role, original_payload FROM watchlist WHERE symbol = ${symbol}`,
  ).map(mapRow);
  const match = existing.find((row) => samePlan(row.plan, found.plan));
  if (match) {
    if (match.role !== "saved" || !match.active) {
      await sql`UPDATE watchlist SET role = 'saved', active = 1 WHERE id = ${match.id}`;
    }
    return { ok: true };
  }
  const payload = JSON.stringify(found.plan);
  await sql`
    INSERT INTO watchlist (id, symbol, saved_at, plan_date, active, role, original_payload, triggered)
    VALUES (${randomUUID().replaceAll("-", "")}, ${symbol}, now(), ${found.planDate}, 1, 'saved', ${payload}::jsonb, 0)`;
  return { ok: true };
}

export async function addWatch(id: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const sql = getSql();
  if (!sql) return { ok: false, error: "DATABASE_URL missing", status: 500 };
  await ensureSchema();
  const row = first<{ role: string }>(await sql`SELECT role FROM watchlist WHERE id = ${id} LIMIT 1`);
  if (!row) return { ok: false, error: "That plan is not on the watchlist", status: 404 };
  if (row.role !== "candidate") return { ok: false, error: "That plan is already saved", status: 400 };
  await sql`UPDATE watchlist SET role = 'saved', active = 1 WHERE id = ${id}`;
  return { ok: true };
}

export async function switchWatch(id: string, retireId: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const sql = getSql();
  if (!sql) return { ok: false, error: "DATABASE_URL missing", status: 500 };
  await ensureSchema();
  const offered = first<{ symbol: string; role: string }>(
    await sql`SELECT symbol, role FROM watchlist WHERE id = ${id} LIMIT 1`,
  );
  const current = first<{ symbol: string; role: string; active: unknown }>(
    await sql`SELECT symbol, role, active FROM watchlist WHERE id = ${retireId} LIMIT 1`,
  );
  if (!offered || !current) return { ok: false, error: "Pick a saved plan and the new plan", status: 404 };
  if (offered.role !== "candidate") return { ok: false, error: "The new plan is already saved", status: 400 };
  if (offered.symbol !== current.symbol || current.role !== "saved" || !flag(current.active)) {
    return { ok: false, error: "Switch replaces one active plan on the same ticker", status: 400 };
  }
  await sql`UPDATE watchlist SET active = 0 WHERE id = ${retireId}`;
  await sql`UPDATE watchlist SET role = 'saved', active = 1 WHERE id = ${id}`;
  return { ok: true };
}

export async function setWatchActive(id: string, active: boolean): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const sql = getSql();
  if (!sql) return { ok: false, error: "DATABASE_URL missing", status: 500 };
  await ensureSchema();
  const row = first(await sql`SELECT id FROM watchlist WHERE id = ${id} LIMIT 1`);
  if (!row) return { ok: false, error: "That plan is not on the watchlist", status: 404 };
  await sql`UPDATE watchlist SET active = ${active ? 1 : 0} WHERE id = ${id}`;
  return { ok: true };
}

export async function deleteWatch(id: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const sql = getSql();
  if (!sql) return { ok: false, error: "DATABASE_URL missing", status: 500 };
  await ensureSchema();
  const existing = first(await sql`SELECT id FROM watchlist WHERE id = ${id} LIMIT 1`);
  if (!existing) return { ok: false, error: "That plan is not on the watchlist", status: 404 };
  await sql`DELETE FROM watchlist WHERE id = ${id}`;
  return { ok: true };
}
