import type { ApiTest, ApiUsage, AvBudget } from "./apis";
import { asDate, asObj, first, getSql, rows, toPngBuffer } from "./db";
import type { AlertRow, DailyBrief, PlanCard, PositionRow, PositionStance, Snapshot, TradeRow, WatchItem } from "./types";
import { ensureSchema } from "./schema";
import { loadWatchlist } from "./watchlist";

type StrategyLabel = { id: string | null; name: string | null };

function nightlyOn(payload: unknown): boolean {
  if (payload == null) return false;
  try {
    const doc = asObj<{ flow?: { clocks?: { nightly?: { enabled?: boolean } } } }>(payload);
    return doc.flow?.clocks?.nightly?.enabled === true;
  } catch {
    return false;
  }
}

const STRATEGY_JOIN = " · ";

/** One plan belongs to one strategy: the latest active strategy with the nightly clock on. */
function strategyLabel(raw: Record<string, unknown>[]): StrategyLabel {
  const active = raw.filter((row) => row.name);
  const nightly = active.filter((row) => nightlyOn(row.payload));
  const chosen = (nightly.length ? nightly : active)[0];
  if (!chosen?.name) return { id: null, name: null };
  return { id: chosen.id ? String(chosen.id) : null, name: String(chosen.name) };
}

function joinedStrategy(name: string): boolean {
  return name.includes(STRATEGY_JOIN);
}

function firstStrategy(name: string): string {
  return name.split(STRATEGY_JOIN).map((part) => part.trim()).find(Boolean) ?? "";
}

function withStrategy(plan: PlanCard, source: StrategyLabel): PlanCard {
  const stored = plan.strategy_name?.trim() ?? "";
  if (joinedStrategy(stored)) return { ...plan, strategy_name: firstStrategy(stored) };
  if (stored || !source.name) return plan;
  return { ...plan, strategy_id: plan.strategy_id ?? source.id, strategy_name: source.name };
}

function labelBrief(brief: DailyBrief | null, source: StrategyLabel): DailyBrief | null {
  if (!brief || !source.name) return brief;
  return {
    ...brief,
    plans: brief.plans?.map((plan) => withStrategy(plan, source)),
    rejected: brief.rejected?.map((plan) => withStrategy(plan, source)),
  };
}

function attachSavedAt(brief: DailyBrief | null, createdAt: unknown): DailyBrief | null {
  if (!brief) return null;
  if (createdAt == null || createdAt === "") return brief;
  const savedAt = createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);
  return savedAt ? { ...brief, savedAt } : brief;
}

function labelWatch(items: WatchItem[], source: StrategyLabel): WatchItem[] {
  if (!source.name) return items;
  return items.map((item) => ({ ...item, plan: withStrategy(item.plan, source) }));
}

function boolish(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

function mapAlert(r: Record<string, unknown>): AlertRow {
  const plan = r.plan_payload == null ? null : planOf(r.plan_payload);
  const planId = r.plan_id == null || r.plan_id === "" ? undefined : String(r.plan_id);
  const fromPlan = plan?.strategy_name?.trim() ?? "";
  const fromTable = r.strategy_name == null ? "" : String(r.strategy_name).trim();
  return {
    day: asDate(r.day),
    ts: String(r.ts),
    symbol: String(r.symbol),
    condition: String(r.condition),
    price: r.price == null ? null : Number(r.price),
    rvol: r.rvol == null ? null : Number(r.rvol),
    vwap: r.vwap == null ? null : Number(r.vwap),
    actionable: boolish(r.actionable),
    message: String(r.message ?? ""),
    planId,
    storedPlanId: planId ?? "",
    strategyId: plan?.strategy_id ?? undefined,
    strategyName: fromPlan || fromTable || undefined,
    planPattern: plan?.pattern,
    planEntry: plan?.entry,
  };
}

type HeldPlan = { id: string; symbol: string; plan: PlanCard };

/** Watchlist cards win when a position still points at the same id. */
function heldPlans(watch: WatchItem[], positions: Record<string, unknown>[]): HeldPlan[] {
  const byId = new Map<string, HeldPlan>();
  for (const row of positions) {
    const id = row.plan_id == null || row.plan_id === "" ? "" : String(row.plan_id);
    const plan = planOf(row.original_plan);
    if (!id || !plan) continue;
    byId.set(id, { id, symbol: String(row.symbol), plan });
  }
  for (const item of watch) byId.set(item.id, { id: item.id, symbol: item.symbol, plan: item.plan });
  return [...byId.values()];
}

function plansForSymbol(held: HeldPlan[], symbol: string): HeldPlan[] {
  return held.filter((row) => row.symbol === symbol);
}

/** Name the plan that fired. Older rows have no plan id, so a ticker with one plan uses that plan. */
function resolveAlert(alert: AlertRow, held: HeldPlan[]): AlertRow {
  const forSymbol = plansForSymbol(held, alert.symbol);
  const match = alert.planId ? held.find((row) => row.id === alert.planId) : forSymbol.length === 1 ? forSymbol[0] : undefined;
  if (!match) return alert;
  const name = match.plan.strategy_name?.trim() ?? "";
  return {
    ...alert,
    planId: match.id,
    strategyId: match.plan.strategy_id ?? alert.strategyId,
    strategyName: name || alert.strategyName,
    planPattern: match.plan.pattern || alert.planPattern,
    planEntry: typeof match.plan.entry === "number" ? match.plan.entry : alert.planEntry,
  };
}

/** Older cards have no strategy written on them. Use the active plan-card strategy, same as the plan list. */
function withAlertStrategy(alert: AlertRow, source: StrategyLabel): AlertRow {
  const stored = alert.strategyName?.trim() ?? "";
  if (joinedStrategy(stored)) return { ...alert, strategyName: firstStrategy(stored) };
  if (stored || !source.name || !alert.planId) return alert;
  return { ...alert, strategyName: source.name, strategyId: alert.strategyId ?? source.id ?? undefined };
}

export const ALERT_PAGE_SIZE = 80;

export type AlertList = {
  configured: boolean;
  alerts: AlertRow[];
  total: number;
  page: number;
  pageSize: number;
  conditions: string[];
};

/** Every alert for a watched symbol or an open position, one page at a time. */
export async function loadAlertList(opts: { page: number; symbol: string; condition: string }): Promise<AlertList> {
  const sql = getSql();
  const empty: AlertList = { configured: Boolean(sql), alerts: [], total: 0, page: 1, pageSize: ALERT_PAGE_SIZE, conditions: [] };
  if (!sql) return empty;

  const symbol = opts.symbol.trim().toUpperCase().replace(/[%_\\]/g, "");
  const condition = opts.condition.trim();
  const pattern = `%${symbol}%`;

  try {
    await ensureSchema();
    const [countRaw, conditionsRaw, strategyRaw] = await Promise.all([
      sql`
        SELECT COUNT(*)::int AS n FROM alerts
        WHERE symbol IN (
          SELECT symbol FROM watchlist
          UNION
          SELECT symbol FROM positions WHERE closed IS NULL
        )
        AND (${condition} = '' OR condition = ${condition})
        AND (${symbol} = '' OR symbol LIKE ${pattern})
      `,
      sql`
        SELECT DISTINCT condition FROM alerts
        WHERE symbol IN (
          SELECT symbol FROM watchlist
          UNION
          SELECT symbol FROM positions WHERE closed IS NULL
        )
        ORDER BY condition
      `,
      sql`SELECT id, name, payload FROM strategies WHERE status = 'active' ORDER BY updated_at DESC`.catch((e) => {
        console.error("strategy label lookup failed", e);
        return [];
      }),
    ]);
    const total = Number(first<{ n: number }>(countRaw)?.n ?? 0);
    const pages = Math.max(1, Math.ceil(total / ALERT_PAGE_SIZE));
    const page = Math.min(Math.max(1, opts.page), pages);
    const offset = (page - 1) * ALERT_PAGE_SIZE;
    const [alertsRaw, watchlist, positionsRaw] = await Promise.all([
      sql`
        SELECT day, ts, symbol, condition, price, rvol, vwap, actionable, message, plan_id
        FROM alerts
        WHERE symbol IN (
          SELECT symbol FROM watchlist
          UNION
          SELECT symbol FROM positions WHERE closed IS NULL
        )
        AND (${condition} = '' OR condition = ${condition})
        AND (${symbol} = '' OR symbol LIKE ${pattern})
        ORDER BY ts DESC, symbol, condition, plan_id
        LIMIT ${ALERT_PAGE_SIZE} OFFSET ${offset}
      `,
      loadWatchlist(),
      sql`SELECT symbol, plan_id, original_plan FROM positions WHERE closed IS NULL`.catch((e) => {
        console.error("position plan lookup failed", e);
        return [];
      }),
    ]);
    const source = strategyLabel(rows<Record<string, unknown>>(strategyRaw));
    const held = heldPlans(watchlist, rows<Record<string, unknown>>(positionsRaw)).map((row) => ({
      ...row,
      plan: withStrategy(row.plan, source),
    }));
    return {
      configured: true,
      alerts: rows<Record<string, unknown>>(alertsRaw).map((row) => withAlertStrategy(resolveAlert(mapAlert(row), held), source)),
      total,
      page,
      pageSize: ALERT_PAGE_SIZE,
      conditions: rows<{ condition: string }>(conditionsRaw).map((r) => String(r.condition)),
    };
  } catch (e) {
    console.error("loadAlertList failed", e);
    return { ...empty, configured: true };
  }
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
    await ensureSchema();
    const [briefs, alertsRaw, positionsRaw, tradesRaw, priceKv, planDateRow, watchlist, strategyRaw] = await Promise.all([
      sql`SELECT brief_date, kind, payload, created_at FROM briefs ORDER BY brief_date DESC, created_at DESC LIMIT 12`,
      sql`SELECT day, ts, symbol, condition, price, rvol, vwap, actionable, message FROM alerts ORDER BY ts DESC LIMIT 80`,
      sql`SELECT * FROM positions WHERE closed IS NULL ORDER BY opened, symbol`,
      sql`SELECT * FROM trades ORDER BY closed DESC, id DESC LIMIT 50`,
      sql`SELECT v, updated_at FROM kv WHERE k = 'prices' LIMIT 1`,
      sql`SELECT MAX(plan_date) AS d FROM plans`,
      loadWatchlist(),
      sql`SELECT id, name, payload FROM strategies WHERE status = 'active' ORDER BY updated_at DESC`.catch((e) => {
        console.error("strategy label lookup failed", e);
        return [];
      }),
    ]);

    const source = strategyLabel(rows<Record<string, unknown>>(strategyRaw));
    const briefRows = rows<{ kind: string; payload: unknown; created_at?: unknown }>(briefs);
    const nightlyRow = briefRows.find((row) => row.kind === "nightly") ?? briefRows[0];
    const premarketRow = briefRows.find((row) => row.kind === "premarket");
    const brief = attachSavedAt(labelBrief(nightlyRow ? asObj<DailyBrief>(nightlyRow.payload) : null, source), nightlyRow?.created_at);
    const premarket = attachSavedAt(
      labelBrief(premarketRow ? asObj<DailyBrief>(premarketRow.payload) : null, source),
      premarketRow?.created_at,
    );

    let prices: Record<string, number> = {};
    let pricesAt: string | null = null;
    const priceRow = first<{ v: unknown; updated_at?: string }>(priceKv);
    if (priceRow) {
      const v = asObj<{ at?: string; prices?: Record<string, number> }>(priceRow.v);
      prices = v.prices ?? {};
      pricesAt = v.at ?? priceRow.updated_at ?? null;
    }

    const alerts: AlertRow[] = rows<Record<string, unknown>>(alertsRaw).map(mapAlert);

    const positions: PositionRow[] = rows<Record<string, unknown>>(positionsRaw).map((row) => {
      const position = mapPosition(row);
      return position.originalPlan ? { ...position, originalPlan: withStrategy(position.originalPlan, source) } : position;
    });
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
      watchlist: labelWatch(watchlist, source),
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
    planId: r.plan_id == null || r.plan_id === "" ? null : String(r.plan_id),
    stance: stanceOf(r.stance),
    stanceReason: r.stance_reason == null ? null : String(r.stance_reason),
    originalPlan: planOf(r.original_plan),
  };
}

function planOf(v: unknown): PlanCard | null {
  if (v == null || v === "") return null;
  try {
    const plan = asObj<PlanCard>(v);
    if (typeof plan.entry !== "number" || typeof plan.stop !== "number") return null;
    return plan;
  } catch {
    return null;
  }
}

function stanceOf(v: unknown): PositionStance | null {
  if (v === "keep" || v === "exit" || v === "sell_half" || v === "raise_stop" || v === "decide") return v;
  return null;
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
  const plan = asObj<PlanCard>(found.payload);
  const stored = plan.strategy_name?.trim() ?? "";
  if (stored && !stored.includes(STRATEGY_JOIN)) return { plan, day: asDate(found.plan_date) };
  let source: StrategyLabel = { id: null, name: null };
  try {
    source = strategyLabel(
      rows<Record<string, unknown>>(
        await sql`SELECT id, name, payload FROM strategies WHERE status = 'active' ORDER BY updated_at DESC`,
      ),
    );
  } catch (e) {
    console.error("strategy label lookup failed", e);
  }
  return { plan: withStrategy(plan, source), day: asDate(found.plan_date) };
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
