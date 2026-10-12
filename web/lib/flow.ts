// Step ids match src/swing/jobs.py (NIGHTLY_STEPS, PREMARKET_STEPS, INTRADAY_STEPS, REPORT_STEPS).

import { sessionKind } from "./nyse-calendar";

export type RunStatus = "running" | "ok" | "skipped" | "failed" | "stalled";
export type BlockStatus = RunStatus | "idle" | "next";

export type FlowRun = {
  id: number;
  job: string;
  step: string | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown> | null;
  error: string | null;
  fallback?: boolean;
};

export type RunInput = {
  id: number;
  job: string;
  step: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown> | null;
  error: string | null;
};

export type BriefStamp = { kind: string; at: string };

export type FlowNode = {
  id: string;
  job: string;
  step: string | null;
  title: string;
  hint: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type FlowEdge = { from: string; to: string; loop?: boolean };

export type FlowNodeView = FlowNode & {
  status: BlockStatus;
  latest: FlowRun | null;
  history: FlowRun[];
};

export type FlowPayload = {
  configured: boolean;
  tableReady: boolean;
  now: string;
  headline: string;
  nextJob: string | null;
  nextAt: string | null;
  nodes: FlowNodeView[];
  edges: FlowEdge[];
  world: { w: number; h: number };
  activeStrategy: { id: string; name: string } | null;
};

const ET = "America/New_York";

const STALE_MS: Record<string, number> = {
  nightly: 30 * 60_000,
  premarket: 15 * 60_000,
  intraday: 15 * 60_000,
  report: 15 * 60_000,
};

const JOB_LABEL: Record<string, string> = {
  premarket: "Premarket",
  intraday: "Intraday",
  nightly: "Nightly",
  report: "Weekly report",
};

const BRIEF_STEP: Record<string, { job: string; step: string }> = {
  nightly: { job: "nightly", step: "publish" },
  premarket: { job: "premarket", step: "publish" },
  eod: { job: "intraday", step: "eod" },
};

const NODE_W = 200;
const NODE_H = 54;
const HEAD_H = 68;
const GAP = 20;
const COLS = [28, 308, 588, 868];

type StepDef = { id: string; title: string };

const COLUMNS: { job: string; title: string; hint: string; x: number; steps: StepDef[] }[] = [
  {
    job: "premarket",
    title: "Premarket",
    hint: "07:03 ET",
    x: COLS[0],
    steps: [
      { id: "guard", title: "Guard" },
      { id: "regime", title: "Regime" },
      { id: "plans", title: "Plans" },
      { id: "earnings", title: "Earnings" },
      { id: "prose", title: "Prose" },
      { id: "publish", title: "Publish" },
    ],
  },
  {
    job: "intraday",
    title: "Intraday",
    hint: "Every 15 min",
    x: COLS[1],
    steps: [
      { id: "session", title: "Session" },
      { id: "plans", title: "Plans" },
      { id: "prices", title: "Prices" },
      { id: "alerts", title: "Alerts" },
      { id: "save", title: "Save" },
      { id: "manage", title: "Manage" },
      { id: "eod", title: "EOD brief" },
    ],
  },
  {
    job: "nightly",
    title: "Nightly",
    hint: "16:48 ET",
    x: COLS[2],
    steps: [
      { id: "guard", title: "Guard" },
      { id: "universe", title: "Universe" },
      { id: "bars", title: "Bars" },
      { id: "screen", title: "Scan" },
      { id: "earnings", title: "Earnings" },
      { id: "patterns", title: "Patterns" },
      { id: "risk", title: "Risk" },
      { id: "charts", title: "Charts" },
      { id: "news", title: "News" },
      { id: "regime", title: "Regime" },
      { id: "evaluate", title: "Evaluate" },
      { id: "prose", title: "Prose" },
      { id: "publish", title: "Publish" },
    ],
  },
  {
    job: "report",
    title: "Weekly report",
    hint: "Fri 17:18 ET",
    x: COLS[3],
    steps: [{ id: "report", title: "Expectancy" }],
  },
];

export function layoutGraph(): { nodes: FlowNode[]; edges: FlowEdge[]; world: { w: number; h: number } } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  for (const col of COLUMNS) {
    const head: FlowNode = {
      id: col.job,
      job: col.job,
      step: null,
      title: col.title,
      hint: col.hint,
      x: col.x,
      y: 20,
      w: NODE_W,
      h: HEAD_H,
    };
    nodes.push(head);
    let prev = head.id;
    col.steps.forEach((step, i) => {
      const node: FlowNode = {
        id: `${col.job}:${step.id}`,
        job: col.job,
        step: step.id,
        title: step.title,
        hint: "",
        x: col.x,
        y: 20 + HEAD_H + 28 + i * (NODE_H + GAP),
        w: NODE_W,
        h: NODE_H,
      };
      nodes.push(node);
      edges.push({ from: prev, to: node.id });
      prev = node.id;
    });
  }
  edges.push({ from: "intraday:save", to: "intraday:session", loop: true });
  const maxX = Math.max(...nodes.map((n) => n.x + n.w));
  const maxY = Math.max(...nodes.map((n) => n.y + n.h));
  return { nodes, edges, world: { w: maxX + 72, h: maxY + 36 } };
}

const STEP_TITLE = new Map<string, string>();
for (const col of COLUMNS) {
  STEP_TITLE.set(col.job, col.title);
  for (const step of col.steps) STEP_TITLE.set(`${col.job}:${step.id}`, step.title);
}

export function stepTitle(job: string, step: string | null): string {
  if (!step) return JOB_LABEL[job] ?? job;
  return STEP_TITLE.get(`${job}:${step}`) ?? step;
}

function etParts(instant: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) bag[p.type] = p.value;
  return bag;
}

function wallToDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  const shown = etParts(new Date(utc));
  const got = Date.UTC(
    Number(shown.year),
    Number(shown.month) - 1,
    Number(shown.day),
    Number(shown.hour),
    Number(shown.minute),
  );
  const want = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(utc + (want - got));
}

function addDays(y: number, m: number, d: number, n: number): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function upcomingSlots(now: Date): { job: string; at: Date }[] {
  const today = etParts(now);
  const start = addDays(Number(today.year), Number(today.month), Number(today.day), -1);
  const out: { job: string; at: Date }[] = [];
  for (let i = 0; i < 10; i++) {
    const day = addDays(start.y, start.m, start.d, i);
    const wd = etParts(wallToDate(day.y, day.m, day.d, 12, 0)).weekday;
    if (wd === "Sat" || wd === "Sun") continue;
    const kind = sessionKind(isoDate(day.y, day.m, day.d));
    if (kind === "closed") continue;
    const early = kind === "early";
    out.push({ job: "premarket", at: wallToDate(day.y, day.m, day.d, 7, 3) });
    const lastHour = early ? 12 : 15;
    for (let hour = 10; hour <= lastHour; hour++) {
      for (const minute of [3, 18, 33, 48]) {
        out.push({ job: "intraday", at: wallToDate(day.y, day.m, day.d, hour, minute) });
      }
    }
    out.push({ job: "nightly", at: wallToDate(day.y, day.m, day.d, early ? 13 : 16, 48) });
    if (wd === "Fri") out.push({ job: "report", at: wallToDate(day.y, day.m, day.d, 17, 18) });
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out;
}

function nextOpening(now: Date, runs: RunInput[]): { job: string; at: Date } | null {
  const starts = runs
    .filter((r) => r.step == null && r.startedAt)
    .map((r) => ({ job: r.job, t: new Date(r.startedAt).getTime() }))
    .filter((r) => !Number.isNaN(r.t));
  const grace = 90_000;
  for (const slot of upcomingSlots(now)) {
    if (slot.at.getTime() < now.getTime() - grace) continue;
    const started = starts.some((s) => s.job === slot.job && s.t >= slot.at.getTime() - grace);
    if (!started) return slot;
  }
  return null;
}

function asStatus(status: string, job: string, startedAt: string, now: Date): RunStatus {
  if (status === "running") {
    const age = now.getTime() - new Date(startedAt).getTime();
    if (Number.isFinite(age) && age > (STALE_MS[job] ?? 15 * 60_000)) return "stalled";
    return "running";
  }
  if (status === "ok" || status === "skipped" || status === "failed" || status === "stalled") return status;
  return "failed";
}

function toRun(row: RunInput, now: Date): FlowRun {
  return {
    id: row.id,
    job: row.job,
    step: row.step,
    status: asStatus(row.status, row.job, row.startedAt, now),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    summary: row.summary,
    error: row.error,
  };
}

function keyOf(job: string, step: string | null): string {
  return `${job}\0${step ?? ""}`;
}

function formatSlot(at: Date, now: Date): string {
  const a = etParts(at);
  const n = etParts(now);
  const time = at.toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
  const same = a.year === n.year && a.month === n.month && a.day === n.day;
  if (same) return `${time} ET`;
  const day = at.toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
  return `${day}, ${time} ET`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: ET,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function buildFlow(
  runs: RunInput[],
  briefs: BriefStamp[],
  now: Date,
  opts: { configured: boolean; tableReady: boolean },
): FlowPayload {
  const graph = layoutGraph();
  const mapped = runs.map((r) => toRun(r, now));
  const groups = new Map<string, FlowRun[]>();
  for (const run of mapped) {
    const k = keyOf(run.job, run.step);
    const list = groups.get(k) ?? [];
    list.push(run);
    groups.set(k, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime() || b.id - a.id);
  }

  for (const brief of briefs) {
    const target = BRIEF_STEP[brief.kind];
    if (!target || !brief.at) continue;
    const k = keyOf(target.job, target.step);
    if (groups.has(k)) continue;
    groups.set(k, [
      {
        id: 0,
        job: target.job,
        step: target.step,
        status: "ok",
        startedAt: brief.at,
        finishedAt: brief.at,
        summary: { source: "Last published brief" },
        error: null,
        fallback: true,
      },
    ]);
  }

  const openJobs = (["premarket", "intraday", "nightly", "report"] as const)
    .map((job) => (groups.get(keyOf(job, null)) ?? [])[0])
    .filter((r): r is FlowRun => Boolean(r && (r.status === "running" || r.status === "stalled")))
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const open = openJobs[0] ?? null;

  const next = open ? null : nextOpening(now, runs);
  const headline = describe(open, groups, next, now, opts);

  const nodes: FlowNodeView[] = graph.nodes.map((node) => {
    const list = groups.get(keyOf(node.job, node.step)) ?? [];
    const latest = list[0] ?? null;
    let status: BlockStatus = latest?.status ?? "idle";
    if (!node.step && next && next.job === node.job && status !== "running" && status !== "stalled") {
      status = "next";
    }
    return { ...node, status, latest, history: list.slice(1, 8) };
  });

  return {
    configured: opts.configured,
    tableReady: opts.tableReady,
    now: now.toISOString(),
    headline,
    nextJob: next?.job ?? null,
    nextAt: next ? next.at.toISOString() : null,
    nodes,
    edges: graph.edges,
    world: graph.world,
    activeStrategy: null,
  };
}

function describe(
  open: FlowRun | null,
  groups: Map<string, FlowRun[]>,
  next: { job: string; at: Date } | null,
  now: Date,
  opts: { configured: boolean; tableReady: boolean },
): string {
  if (open) {
    const live = [...groups.values()]
      .flat()
      .filter((s) => s.job === open.job && s.step && (s.status === "running" || s.status === "stalled"))
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
    const fromSummary = typeof open.summary?.current === "string" ? open.summary.current : null;
    const stepId = live?.step ?? fromSummary;
    const title = stepId ? stepTitle(open.job, stepId) : "";
    const label = JOB_LABEL[open.job] ?? open.job;
    if (open.status === "stalled") {
      return title
        ? `${label} looks stalled on ${title} since ${formatWhen(open.startedAt)}`
        : `${label} looks stalled since ${formatWhen(open.startedAt)}`;
    }
    return title ? `${label} is running — ${title}` : `${label} is running`;
  }
  if (!opts.configured) {
    return "Connect Neon to see which step is running. The chart is the pipeline the jobs follow.";
  }
  if (!opts.tableReady) {
    const when = next ? ` Next up: ${JOB_LABEL[next.job] ?? next.job} at ${formatSlot(next.at, now)}.` : "";
    return `The chart is the pipeline.${when} Run swing db-init so the next job can record each step.`;
  }
  if (next) return `Next up: ${JOB_LABEL[next.job] ?? next.job} at ${formatSlot(next.at, now)}`;
  return "The pipeline is idle.";
}
