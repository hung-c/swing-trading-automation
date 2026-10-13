import type { ApiTest, ApiUsage, AvBudget } from "./apis";
import { asDate, asObj, first, getSql, rows, toPngBuffer } from "./db";
import type { AlertRow, DailyBrief, PlanCard, PositionRow, Snapshot, TradeRow } from "./types";
import { loadWatchlist } from "./watchlist";

function boolish(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

export async function loadSnapshot(): Promise<Snapshot> {
  const sql = getSql();
  const empty: Snapshot = {
    configured: Boolean(sql),
    brief: null,
    premarket: null,
    alerts: [],
    positions: [],
    trades: [],
    prices: {},
    pricesAt: null,
    planDate: null,
    watchlist: [],
  };
  if (!sql) return empty;

  try {
    const [briefs, alertsRaw, positionsRaw, tradesRaw, priceKv, planDateRow, watchlist] = await Promise.all([
      sql`SELECT brief_date, kind, payload, created_at FROM briefs ORDER BY brief_date DESC, created_at DESC LIMIT 12`,
      sql`SELECT day, ts, symbol, condition, price, rvol, vwap, actionable, message FROM alerts ORDER BY ts DESC LIMIT 80`,
      sql`SELECT * FROM positions WHERE closed IS NULL ORDER BY opened, symbol`,
      sql`SELECT * FROM trades ORDER BY closed DESC, id DESC LIMIT 50`,
      sql`SELECT v, updated_at FROM kv WHERE k = 'prices' LIMIT 1`,
      sql`SELECT MAX(plan_date) AS d FROM plans`,
      loadWatchlist(),
    ]);

    const parsed = rows<{ kind: string; payload: unknown }>(briefs).map((r) => asObj<DailyBrief>(r.payload));
    const brief = parsed.find((b) => b.kind === "nightly") ?? parsed[0] ?? null;
    const day = brief?.date;
    const premarket = parsed.find((b) => b.kind === "premarket" && (!day || b.date === day)) ?? null;

    let prices: Record<string, number> = {};
    let pricesAt: string | null = null;
    const priceRow = first<{ v: unknown; updated_at?: string }>(priceKv);
    if (priceRow) {
      const v = asObj<{ at?: string; prices?: Record<string, number> }>(priceRow.v);
      prices = v.prices ?? {};
      pricesAt = v.at ?? priceRow.updated_at ?? null;
    }

    const alerts: AlertRow[] = rows<Record<string, unknown>>(alertsRaw).map((r) => ({
      day: asDate(r.day),
      ts: String(r.ts),
      symbol: String(r.symbol),
      condition: String(r.condition),
      price: r.price == null ? null : Number(r.price),
      rvol: r.rvol == null ? null : Number(r.rvol),
      vwap: r.vwap == null ? null : Number(r.vwap),
      actionable: boolish(r.actionable),
      message: String(r.message ?? ""),
    }));

    const positions: PositionRow[] = rows<Record<string, unknown>>(positionsRaw).map(mapPosition);
    const trades: TradeRow[] = rows<Record<string, unknown>>(tradesRaw).map((r) => ({
      id: Number(r.id),
      symbol: String(r.symbol),
      opened: r.opened ? asDate(r.opened) : null,
      closed: r.closed ? asDate(r.closed) : null,
      entry: r.entry == null ? null : Number(r.entry),
      exit_price: r.exit_price == null ? null : Number(r.exit_price),
      shares: r.shares == null ? null : Number(r.shares),
      r_multiple: r.r_multiple == null ? null : Number(r.r_multiple),
      pattern: r.pattern == null ? null : String(r.pattern),
      sector: r.sector == null ? null : String(r.sector),
    }));

    const latestPlan = first<{ d?: unknown }>(planDateRow);
    const armed = new Set<string>([...watchlist.map((w) => w.symbol), ...positions.map((p) => p.symbol)]);
    return {
      configured: true,
      brief,
      premarket,
      alerts: alerts.filter((a) => armed.has(a.symbol)),
      positions,
      trades,
      prices,
      pricesAt,
      planDate: latestPlan?.d ? asDate(latestPlan.d) : brief?.date ?? null,
      watchlist,
    };
  } catch (e) {
    console.error("loadSnapshot failed", e);
    return { ...empty, configured: true };
  }
}

function mapPosition(r: Record<string, unknown>): PositionRow {
  return {
    symbol: String(r.symbol),
    opened: asDate(r.opened),
    entry: Number(r.entry),
    stop: Number(r.stop),
    initial_stop: Number(r.initial_stop),
    shares: Number(r.shares),
    target_2r: Number(r.target_2r),
    pattern: r.pattern == null ? null : String(r.pattern),
    sector: r.sector == null ? null : String(r.sector),
    half_sold: boolish(r.half_sold),
    closed: r.closed ? asDate(r.closed) : null,
    exit_price: r.exit_price == null ? null : Number(r.exit_price),
    r_multiple: r.r_multiple == null ? null : Number(r.r_multiple),
    resistance: r.resistance == null ? null : Number(r.resistance),
  };
}

export async function loadApiUsage(): Promise<{ configured: boolean; usage: ApiUsage | null; av: AvBudget | null; test: ApiTest | null }> {
  const sql = getSql();
  const empty = { configured: Boolean(sql), usage: null, av: null, test: null };
  if (!sql) return empty;
  try {
    const found = rows<{ k: string; v: unknown; updated_at?: string }>(
      await sql`SELECT k, v, updated_at FROM kv WHERE k IN ('api_usage', 'av_budget', 'api_test')`,
    );
    let usage: ApiUsage | null = null;
    let av: AvBudget | null = null;
    let test: ApiTest | null = null;
    for (const row of found) {
      if (row.k === "api_usage") {
        const v = asObj<{
          date?: string;
          calls?: Record<string, number>;
          jobs?: Record<string, { runs?: number; calls?: Record<string, number> }>;
          secrets?: Record<string, boolean>;
        }>(row.v);
        const jobs: ApiUsage["jobs"] = {};
        for (const [name, bucket] of Object.entries(v.jobs ?? {})) {
          jobs[name] = { runs: Number(bucket?.runs ?? 0), calls: bucket?.calls ?? {} };
        }
        usage = {
          date: String(v.date ?? ""),
          calls: v.calls ?? {},
          jobs,
          secrets: v.secrets ?? {},
          updatedAt: row.updated_at ?? null,
        };
      } else if (row.k === "av_budget") {
        const v = asObj<{ date?: string; used?: number }>(row.v);
        av = { date: String(v.date ?? ""), used: Number(v.used ?? 0) };
      } else if (row.k === "api_test") {
        const v = asObj<{ at?: string; results?: ApiTest["results"] }>(row.v);
        test = { at: String(v.at ?? row.updated_at ?? ""), results: v.results ?? [] };
      }
    }
    return { configured: true, usage, av, test };
  } catch (e) {
    console.error("loadApiUsage failed", e);
    return { ...empty, configured: true };
  }
}

export async function loadPlan(symbol: string): Promise<{ plan: PlanCard; day: string } | null> {
  const sql = getSql();
  if (!sql) return null;
  const found = first<{ plan_date: unknown; payload: unknown }>(
    await sql`
    SELECT plan_date, payload FROM plans
    WHERE symbol = ${symbol.toUpperCase()}
    ORDER BY plan_date DESC LIMIT 1`,
  );
  if (!found) return null;
  return { plan: asObj<PlanCard>(found.payload), day: asDate(found.plan_date) };
}

export async function loadChartPng(day: string, symbol: string, kind: string): Promise<Buffer | null> {
  const sql = getSql();
  if (!sql) return null;
  const found = first<{ png: unknown }>(
    await sql`
    SELECT png FROM charts WHERE day = ${day} AND symbol = ${symbol.toUpperCase()} AND kind = ${kind} LIMIT 1`,
  );
  if (!found?.png) return null;
  return toPngBuffer(found.png);
}
