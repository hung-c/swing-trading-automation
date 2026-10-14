import { asObj, first, getSql, rows } from "./db";
import {
  buildTickStatus,
  isJobName,
  parseHeartbeat,
  TICK_QUEUE_PREFIX,
  type JobName,
  type StrategyInput,
  type TickRun,
  type TickStatus,
} from "./tick-status";

function iso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function summaryOf(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

export async function loadTickStatus(now = new Date()): Promise<TickStatus> {
  const sql = getSql();
  if (!sql) return buildTickStatus({ configured: false, now, heartbeat: null, strategies: [], runs: [] });

  try {
    const [kvRaw, strategyRaw, runRaw, queueRaw] = await Promise.all([
      sql`SELECT v, updated_at FROM kv WHERE k = 'tick' LIMIT 1`,
      sql`SELECT id, name, status, payload FROM strategies WHERE status = 'active' ORDER BY name`,
      sql`
        SELECT id, job, step, status, started_at, finished_at, summary, error
        FROM job_runs
        WHERE step IS NULL AND started_at > NOW() - INTERVAL '4 days'
        ORDER BY started_at DESC, id DESC
        LIMIT 80
      `,
      sql`SELECT k, v FROM kv WHERE k LIKE ${`${TICK_QUEUE_PREFIX}%`}`,
    ]);

    const kv = first<{ v: unknown; updated_at?: unknown }>(kvRaw);
    let heartbeat = null;
    if (kv) {
      try {
        heartbeat = parseHeartbeat(asObj(kv.v), iso(kv.updated_at));
      } catch {
        heartbeat = null;
      }
    }

    const strategies: StrategyInput[] = rows<Record<string, unknown>>(strategyRaw).map((row) => {
      let payload = row.payload;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload) as unknown;
        } catch {
          payload = null;
        }
      }
      return {
        id: String(row.id),
        name: String(row.name),
        status: String(row.status),
        payload,
      };
    });

    const runs: TickRun[] = rows<Record<string, unknown>>(runRaw).map((row) => ({
      id: Number(row.id),
      job: String(row.job),
      step: row.step == null || row.step === "" ? null : String(row.step),
      status: String(row.status),
      startedAt: iso(row.started_at) ?? new Date(0).toISOString(),
      finishedAt: iso(row.finished_at),
      summary: summaryOf(row.summary),
      error: row.error == null ? null : String(row.error),
    }));

    const queued: JobName[] = [];
    for (const row of rows<{ k: unknown; v: unknown }>(queueRaw)) {
      const key = String(row.k ?? "");
      const job = key.startsWith(TICK_QUEUE_PREFIX) ? key.slice(TICK_QUEUE_PREFIX.length) : "";
      if (!isJobName(job)) continue;
      let stamp = "";
      try {
        const value = asObj<{ at?: unknown }>(row.v);
        stamp = typeof value.at === "string" ? value.at : "";
      } catch {
        stamp = "";
      }
      if (stamp) queued.push(job);
    }

    return buildTickStatus({ configured: true, now, heartbeat, strategies, runs, queued });
  } catch (error) {
    console.error("loadTickStatus failed", error);
    return buildTickStatus({ configured: true, readError: true, now, heartbeat: null, strategies: [], runs: [] });
  }
}
