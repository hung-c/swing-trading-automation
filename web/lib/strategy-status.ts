import type { BlockStatus, FlowNodeView, FlowPayload, FlowRun } from "./flow";
import { clockOf, type BlockId, type FlowClock } from "./strategy-flow";

/** Job step that lights a rule block. Clocks use the job row (step null). */
const BLOCK_STEP: Partial<Record<BlockId, { job: string; step: string }>> = {
  universe: { job: "nightly", step: "universe" },
  scanner: { job: "nightly", step: "screen" },
  technical: { job: "nightly", step: "patterns" },
  risk: { job: "nightly", step: "risk" },
  news: { job: "nightly", step: "news" },
  evaluator: { job: "nightly", step: "evaluate" },
  alerts: { job: "intraday", step: "alerts" },
  management: { job: "intraday", step: "manage" },
};

const MAPPED_STEP = new Set([
  "nightly:universe",
  "nightly:screen",
  "nightly:patterns",
  "nightly:risk",
  "nightly:news",
  "nightly:regime",
  "nightly:evaluate",
  "premarket:regime",
  "intraday:alerts",
  "intraday:manage",
]);

const CLOCK_JOB: Record<FlowClock, string> = {
  nightly: "nightly",
  premarket: "premarket",
  intraday: "intraday",
  report: "report",
};

export type StepRun = {
  id: string;
  title: string;
  status: BlockStatus;
  latest: FlowRun | null;
};

export type BlockRun = {
  status: BlockStatus;
  latest: FlowRun | null;
  steps: StepRun[];
};

const EMPTY: BlockRun = { status: "idle", latest: null, steps: [] };

function byKey(payload: FlowPayload): Map<string, FlowNodeView> {
  return new Map(payload.nodes.map((n) => [n.id, n]));
}

function pick(a: FlowNodeView | undefined, b: FlowNodeView | undefined): FlowNodeView | undefined {
  if (!a?.latest) return b?.latest ? b : a;
  if (!b?.latest) return a;
  const live = (n: FlowNodeView) => n.status === "running" || n.status === "stalled";
  if (live(a) !== live(b)) return live(a) ? a : b;
  return a.latest.startedAt >= b.latest.startedAt ? a : b;
}

export function strategyBlockRun(payload: FlowPayload | null, block: BlockId): BlockRun {
  if (!payload) return EMPTY;
  const nodes = byKey(payload);
  const clock = clockOf(block);
  if (clock) {
    const job = CLOCK_JOB[clock];
    const head = nodes.get(job);
    const steps = payload.nodes
      .filter((n) => n.job === job && n.step && !MAPPED_STEP.has(n.id))
      .map((n) => ({ id: n.id, title: n.title, status: n.status, latest: n.latest }));
    return { status: head?.status ?? "idle", latest: head?.latest ?? null, steps };
  }
  if (block === "regime") {
    const chosen = pick(nodes.get("nightly:regime"), nodes.get("premarket:regime"));
    return { status: chosen?.status ?? "idle", latest: chosen?.latest ?? null, steps: [] };
  }
  const mapped = BLOCK_STEP[block];
  if (!mapped) return EMPTY;
  const node = nodes.get(`${mapped.job}:${mapped.step}`);
  return { status: node?.status ?? "idle", latest: node?.latest ?? null, steps: [] };
}

export function statusWord(status: BlockStatus): string {
  if (status === "running") return "Running";
  if (status === "next") return "Up next";
  if (status === "ok" || status === "skipped") return "Done";
  if (status === "failed" || status === "stalled") return "Failed";
  return "No run yet";
}

export function statusLine(run: BlockRun): string {
  if (run.status === "running") return "Running";
  if (run.status === "next") return "Up next";
  if (run.status === "idle" || !run.latest) return "No run yet";
  const stamp = runStamp(run.latest.finishedAt ?? run.latest.startedAt);
  return `${statusWord(run.status)} · ${stamp}`;
}

function formatRun(iso: string | null, withDate: boolean): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    ...(withDate ? { month: "short" as const, day: "numeric" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

export function runStamp(iso: string | null): string {
  return formatRun(iso, false);
}

export function runWhen(iso: string | null): string {
  return formatRun(iso, true);
}

export function runDuration(run: FlowRun): string {
  if (!run.finishedAt) return "In progress";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function runSummary(summary: Record<string, unknown> | null): string {
  if (!summary) return "";
  return Object.entries(summary)
    .filter(([k]) => k !== "current")
    .map(([k, v]) => {
      const label = k.replaceAll("_", " ");
      const value = Array.isArray(v) ? v.join(", ") : typeof v === "object" && v != null ? JSON.stringify(v) : String(v);
      return `${label} ${value}`;
    })
    .join(" · ");
}

export function deskNote(strategyId: string | undefined, payload: FlowPayload | null): string {
  const desk = payload?.activeStrategy;
  if (!desk || (strategyId && desk.id === strategyId)) return "";
  return `The desk is running ${desk.name}. `;
}
