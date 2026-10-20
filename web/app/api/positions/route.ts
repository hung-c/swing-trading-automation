import { NextResponse } from "next/server";
import { asObj, first, getSql, rows } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import type { PlanCard } from "@/lib/types";

export const runtime = "nodejs";

const PATTERNS = new Set(["bull_flag", "flat_base", "ascending_triangle", "cup_handle", "generic_base", "none"]);

function fillPlan(symbol: string, entry: number, stop: number, shares: number, target: number, resistance: number | null, pattern: string) {
  const risk = entry - stop;
  const known = PATTERNS.has(pattern) ? pattern : "none";
  return {
    symbol,
    pattern: known,
    resistance: resistance ?? entry,
    entry,
    stop,
    risk_per_share: risk,
    stop_pct: entry ? (risk / entry) * 100 : 0,
    shares: Math.round(shares),
    fractional_shares: shares,
    notional: entry * shares,
    target_2r: target,
    target_3r: target,
    atr14: 0,
    stop_atr_mult: 0,
    trend_score: 0,
    pattern_quality: 0,
    alert_level: entry,
    status: "open",
  };
}

export async function POST(req: Request) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL missing" }, { status: 500 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "open");
  try {
    await ensureSchema();
    if (action === "switch_plan") {
      const symbol = String(body.symbol ?? "").toUpperCase();
      const planId = String(body.planId ?? "");
      if (!symbol || !planId) return NextResponse.json({ error: "symbol and planId required" }, { status: 400 });
      const row = first<{ symbol: string; original_payload: unknown }>(
        await sql`SELECT symbol, original_payload FROM watchlist WHERE id = ${planId} LIMIT 1`,
      );
      if (!row || row.symbol !== symbol) return NextResponse.json({ error: "That plan is not for this ticker" }, { status: 404 });
      const open = first(await sql`SELECT symbol FROM positions WHERE symbol = ${symbol} AND closed IS NULL LIMIT 1`);
      if (!open) return NextResponse.json({ error: "no open position" }, { status: 404 });
      const payload = JSON.stringify(asObj<PlanCard>(row.original_payload));
      await sql`
        UPDATE positions
        SET plan_id = ${planId}, original_plan = ${payload}::jsonb, stance = NULL, stance_reason = NULL, stance_at = NULL
        WHERE symbol = ${symbol} AND closed IS NULL`;
      return NextResponse.json({ ok: true });
    }
    if (action === "close") {
      const symbol = String(body.symbol ?? "").toUpperCase();
      const exit = Number(body.exit_price);
      if (!symbol || !Number.isFinite(exit)) {
        return NextResponse.json({ error: "symbol and exit_price required" }, { status: 400 });
      }
      const p = first<Record<string, unknown>>(
        await sql`SELECT * FROM positions WHERE symbol = ${symbol} AND closed IS NULL LIMIT 1`,
      );
      if (!p) return NextResponse.json({ error: "no open position" }, { status: 404 });
      const risk = Number(p.entry) - Number(p.initial_stop);
      const r = risk ? (exit - Number(p.entry)) / risk : null;
      const closed = new Date().toISOString().slice(0, 10);
      await sql`
        UPDATE positions SET closed = ${closed}, exit_price = ${exit}, r_multiple = ${r}
        WHERE symbol = ${symbol}`;
      await sql`
        INSERT INTO trades (symbol, opened, closed, entry, initial_stop, exit_price, shares, r_multiple, pattern, sector)
        VALUES (${symbol}, ${p.opened}, ${closed}, ${p.entry}, ${p.initial_stop}, ${exit}, ${p.shares}, ${r}, ${p.pattern}, ${p.sector})`;
      return NextResponse.json({ ok: true, r_multiple: r });
    }

    const symbol = String(body.symbol ?? "").toUpperCase().trim();
    const entry = Number(body.entry);
    const stop = Number(body.stop);
    const shares = Number(body.shares);
    const target = Number(body.target_2r);
    const opened = String(body.opened ?? "").slice(0, 10);
    if (!symbol || !opened || ![entry, stop, shares, target].every(Number.isFinite)) {
      return NextResponse.json({ error: "symbol, opened, entry, stop, shares, target_2r required" }, { status: 400 });
    }
    const resistance = body.resistance === "" || body.resistance == null ? null : Number(body.resistance);
    const pattern = String(body.pattern ?? "") || null;
    const saved = rows<{ id: string; original_payload: unknown }>(
      await sql`SELECT id, original_payload FROM watchlist
                WHERE symbol = ${symbol} AND active = 1 AND role = 'saved'
                ORDER BY saved_at, id`,
    );
    let planId = String(body.planId ?? "");
    if (!planId && saved.length === 1) planId = saved[0].id;
    if (saved.length > 1 && !saved.some((row) => row.id === planId)) {
      return NextResponse.json({ error: "Choose which plan this fill follows" }, { status: 400 });
    }
    const chosen = saved.find((row) => row.id === planId);
    const original = chosen ? asObj<PlanCard>(chosen.original_payload) : fillPlan(symbol, entry, stop, shares, target, resistance, pattern ?? "");
    const originalJson = JSON.stringify(original);
    const boundId = chosen ? chosen.id : null;
    await sql`
      INSERT INTO positions (symbol, opened, entry, stop, initial_stop, shares, target_2r, pattern, sector,
                             half_sold, closed, exit_price, r_multiple, resistance,
                             plan_id, original_plan, stance, stance_reason, stance_at)
      VALUES (${symbol}, ${opened}, ${entry}, ${stop}, ${stop}, ${shares}, ${target}, ${pattern}, NULL,
              0, NULL, NULL, NULL, ${resistance}, ${boundId}, ${originalJson}::jsonb, NULL, NULL, NULL)
      ON CONFLICT (symbol) DO UPDATE SET
        opened = excluded.opened, entry = excluded.entry, stop = excluded.stop,
        initial_stop = excluded.initial_stop, shares = excluded.shares, target_2r = excluded.target_2r,
        pattern = excluded.pattern, half_sold = 0, closed = NULL, exit_price = NULL, r_multiple = NULL,
        resistance = excluded.resistance, plan_id = excluded.plan_id, original_plan = excluded.original_plan,
        stance = NULL, stance_reason = NULL, stance_at = NULL`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("positions", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
