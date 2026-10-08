import { NextResponse } from "next/server";
import { first, getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL missing" }, { status: 500 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "open");
  try {
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
    await sql`
      INSERT INTO positions (symbol, opened, entry, stop, initial_stop, shares, target_2r, pattern, sector,
                             half_sold, closed, exit_price, r_multiple, resistance)
      VALUES (${symbol}, ${opened}, ${entry}, ${stop}, ${stop}, ${shares}, ${target}, ${pattern}, NULL,
              0, NULL, NULL, NULL, ${resistance})
      ON CONFLICT (symbol) DO UPDATE SET
        opened = excluded.opened, entry = excluded.entry, stop = excluded.stop,
        initial_stop = excluded.initial_stop, shares = excluded.shares, target_2r = excluded.target_2r,
        pattern = excluded.pattern, half_sold = 0, closed = NULL, exit_price = NULL, r_multiple = NULL,
        resistance = excluded.resistance`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("positions", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
