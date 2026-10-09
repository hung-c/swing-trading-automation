/** Per-strategy job graph. Block ids are stable so a saved chart still matches the rule sections. */

export const FLOW_CLOCKS = ["nightly", "premarket", "intraday", "report"] as const;
export type FlowClock = (typeof FLOW_CLOCKS)[number];

export const BLOCK_IDS = [
  "profile",
  "clock:nightly",
  "clock:premarket",
  "clock:intraday",
  "clock:report",
  "universe",
  "scanner",
  "technical",
  "risk",
  "regime",
  "news",
  "alerts",
  "management",
  "evaluator",
] as const;

export type BlockId = (typeof BLOCK_IDS)[number];

export type StrategyNode = { id: BlockId; x: number; y: number };
export type StrategyLink = { from: BlockId; to: BlockId };

export type ClockSchedule = { enabled: boolean; start: string; end?: string };

export type StrategyFlow = {
  nodes: StrategyNode[];
  links: StrategyLink[];
  clocks: Record<FlowClock, ClockSchedule>;
};

/** Defaults the PC tick uses when a saved strategy has no start time. Keep in sync with src/swing/tick.py. */
export const CLOCK_DEFAULTS: Record<FlowClock, { start: string; end?: string }> = {
  nightly: { start: "16:37" },
  premarket: { start: "07:03" },
  intraday: { start: "10:00", end: "15:50" },
  report: { start: "17:11" },
};

export const NODE_W = 188;
export const NODE_H = 62;

const COL_W = 248;
const ROW_H = 92;

export const BLOCK_META: Record<BlockId, { title: string; kicker: string; when: string }> = {
  profile: { title: "Profile", kicker: "Strategy", when: "Name and thesis" },
  "clock:nightly": { title: "Nightly", kicker: "Job", when: "16:37 ET" },
  "clock:premarket": { title: "Premarket", kicker: "Job", when: "07:03 ET" },
  "clock:intraday": { title: "Intraday", kicker: "Job", when: "Every 15 min" },
  "clock:report": { title: "Weekly report", kicker: "Job", when: "Fri 17:11 ET" },
  universe: { title: "Universe", kicker: "Rules", when: "Who is eligible" },
  scanner: { title: "Scanner", kicker: "Rules", when: "Hard filters" },
  technical: { title: "Technical", kicker: "Rules", when: "Patterns and trend" },
  risk: { title: "Risk", kicker: "Rules", when: "Size and stops" },
  regime: { title: "Regime", kicker: "Rules", when: "Market gate" },
  news: { title: "News", kicker: "Rules", when: "Headline veto" },
  alerts: { title: "Alerts", kicker: "Rules", when: "Intraday trigger" },
  management: { title: "Management", kicker: "Rules", when: "After the fill" },
  evaluator: { title: "Evaluator", kicker: "Rules", when: "Written judgment" },
};

export const CLOCK_COPY: Record<FlowClock, string> = {
  nightly: "After the close. This job builds the universe, scans, and writes plan cards.",
  premarket: "Before the open. This job re-reads the regime and arms the plans from the last nightly run.",
  intraday: "Every 15 minutes from 10:03 to 15:48 ET. Prices, alerts, and management of open positions.",
  report: "Friday after the close. Expectancy for the names this strategy has traded.",
};

const REVIEW_BLOCK: Record<string, BlockId> = {
  Profile: "profile",
  Universe: "universe",
  Scanner: "scanner",
  Technical: "technical",
  Risk: "risk",
  Regime: "regime",
  News: "news",
  Alerts: "alerts",
  Management: "management",
  Evaluator: "evaluator",
};

const BLOCK_SET = new Set<string>(BLOCK_IDS);

export function isBlockId(id: string): id is BlockId {
  return BLOCK_SET.has(id);
}

export function clockWhen(clock: FlowClock, row: { start: string; end?: string }): string {
  if (clock === "intraday") return `Every 15 min, ${row.start}-${row.end ?? CLOCK_DEFAULTS.intraday.end} ET`;
  if (clock === "report") return `Fri ${row.start} ET`;
  return `${row.start} ET`;
}

export function clockOf(id: BlockId): FlowClock | null {
  if (!id.startsWith("clock:")) return null;
  const clock = id.slice("clock:".length);
  return (FLOW_CLOCKS as readonly string[]).includes(clock) ? (clock as FlowClock) : null;
}

export function blockForReview(section: string): BlockId | null {
  return REVIEW_BLOCK[section] ?? null;
}

function at(col: number, row: number): { x: number; y: number } {
  return { x: 28 + col * COL_W, y: 20 + row * ROW_H };
}

const DEFAULT_NODES: StrategyNode[] = [
  { id: "profile", ...at(0, 0) },
  { id: "clock:nightly", ...at(0, 1) },
  { id: "universe", ...at(0, 2) },
  { id: "scanner", ...at(0, 3) },
  { id: "technical", ...at(0, 4) },
  { id: "risk", ...at(0, 5) },
  { id: "news", ...at(0, 6) },
  { id: "regime", ...at(0, 7) },
  { id: "evaluator", ...at(0, 8) },
  { id: "clock:premarket", ...at(1, 1) },
  { id: "clock:intraday", ...at(2, 1) },
  { id: "alerts", ...at(2, 2) },
  { id: "management", ...at(2, 3) },
  { id: "clock:report", ...at(3, 1) },
];

const DEFAULT_LINKS: StrategyLink[] = [
  { from: "clock:nightly", to: "universe" },
  { from: "universe", to: "scanner" },
  { from: "scanner", to: "technical" },
  { from: "technical", to: "risk" },
  { from: "risk", to: "news" },
  { from: "news", to: "regime" },
  { from: "regime", to: "evaluator" },
  { from: "clock:premarket", to: "regime" },
  { from: "clock:intraday", to: "alerts" },
  { from: "alerts", to: "management" },
];

export function defaultFlow(): StrategyFlow {
  return {
    nodes: DEFAULT_NODES.map((n) => ({ ...n })),
    links: DEFAULT_LINKS.map((l) => ({ ...l })),
    clocks: {
      nightly: { enabled: true, start: CLOCK_DEFAULTS.nightly.start },
      premarket: { enabled: true, start: CLOCK_DEFAULTS.premarket.start },
      intraday: { enabled: true, start: CLOCK_DEFAULTS.intraday.start, end: CLOCK_DEFAULTS.intraday.end },
      report: { enabled: false, start: CLOCK_DEFAULTS.report.start },
    },
  };
}

function finite(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(4000, Math.max(0, n));
}

function clockTime(v: unknown, fallback: string): string {
  const s = String(v ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : fallback;
}

function linkKey(from: BlockId, to: BlockId): string {
  return `${from}\0${to}`;
}

export function normalizeFlow(input: unknown): StrategyFlow {
  const base = defaultFlow();
  const src = input && typeof input === "object" ? (input as { nodes?: unknown; links?: unknown; clocks?: unknown }) : {};
  const placed = new Map(base.nodes.map((n) => [n.id, n]));
  if (Array.isArray(src.nodes)) {
    for (const item of src.nodes) {
      if (!item || typeof item !== "object") continue;
      const row = item as { id?: unknown; x?: unknown; y?: unknown };
      const id = String(row.id ?? "");
      if (!isBlockId(id)) continue;
      const x = finite(row.x);
      const y = finite(row.y);
      if (x == null || y == null) continue;
      placed.set(id, { id, x, y });
    }
  }
  const links: StrategyLink[] = [];
  const seen = new Set<string>();
  const rawLinks = Array.isArray(src.links) ? src.links : base.links;
  for (const item of rawLinks) {
    if (!item || typeof item !== "object") continue;
    const row = item as { from?: unknown; to?: unknown };
    const from = String(row.from ?? "");
    const to = String(row.to ?? "");
    if (!isBlockId(from) || !isBlockId(to) || from === to) continue;
    const key = linkKey(from, to);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ from, to });
  }
  const clocks = { ...base.clocks };
  const rawClocks = src.clocks && typeof src.clocks === "object" ? (src.clocks as Record<string, unknown>) : {};
  for (const clock of FLOW_CLOCKS) {
    const row = rawClocks[clock];
    const obj = row && typeof row === "object" ? (row as { enabled?: unknown; start?: unknown; end?: unknown }) : {};
    const enabled = typeof obj.enabled === "boolean" ? obj.enabled : base.clocks[clock].enabled;
    const start = clockTime(obj.start, base.clocks[clock].start);
    if (clock === "intraday") {
      clocks[clock] = { enabled, start, end: clockTime(obj.end, base.clocks.intraday.end ?? "15:50") };
    } else {
      clocks[clock] = { enabled, start };
    }
  }
  return {
    nodes: BLOCK_IDS.map((id) => placed.get(id) ?? base.nodes.find((n) => n.id === id)!),
    links,
    clocks,
  };
}

export function linkId(link: StrategyLink): string {
  return linkKey(link.from, link.to);
}
