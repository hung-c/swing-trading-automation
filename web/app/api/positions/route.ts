import { NextResponse } from "next/server";
import { asObj, first, getSql } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import type { PlanCard } from "@/lib/types";

export const runtime = "nodejs";

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

    const entry = Number(body.entry);
    const stop = Number(body.stop);
    const shares = Number(body.shares);
    const target = Number(body.target_2r);
    const opened = String(body.opened ?? "").slice(0, 10);
    const planId = String(body.planId ?? "");
    if (!planId || !opened || ![entry, stop, shares, target].every(Number.isFinite)) {
      return NextResponse.json({ error: "Choose a saved plan, then enter the fill" }, { status: 400 });
    }
    const chosen = first<{ id: string; symbol: string; original_payload: unknown }>(
      await sql`SELECT id, symbol, original_payload FROM watchlist
                WHERE id = ${planId} AND active = 1 AND role = 'saved'
                LIMIT 1`,
    );
    if (!chosen) return NextResponse.json({ error: "Choose a saved plan" }, { status: 400 });
    const original = asObj<PlanCard>(chosen.original_payload);
    const symbol = String(chosen.symbol || original.symbol || "").toUpperCase().trim();
    if (!symbol) return NextResponse.json({ error: "That plan has no symbol" }, { status: 400 });
    const pattern = original.pattern ? String(original.pattern) : null;
    const resistance = Number.isFinite(Number(original.resistance)) ? Number(original.resistance) : null;
    const originalJson = JSON.stringify(original);
    const boundId = chosen.id;
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
