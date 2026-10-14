// Job PC status. Due rules match src/swing/tick.py. Tick times match scripts/install-tick.ps1.

import { stepTitle } from "./flow";
import { sessionKind } from "./nyse-calendar";
import { TICK_TIMES } from "./strategy-flow";

export const JOB_ORDER = ["premarket", "intraday", "nightly", "report"] as const;
export type JobName = (typeof JOB_ORDER)[number];

/** Keep in sync with QUEUE_PREFIX in src/swing/tick.py. */
export const TICK_QUEUE_PREFIX = "tick_queue:";

export function isJobName(value: string): value is JobName {
  return (JOB_ORDER as readonly string[]).includes(value);
}

const ET = "America/New_York";
const TICK_START = 7 * 60 + 3;
const TICK_END = 19 * 60 + 3;
const GRACE_MS = 5 * 60_000;
const SLOT_SKEW_MS = 2 * 60_000;
const STALE_MS = 60 * 60_000;
const INTERVAL_MS = 15 * 60_000;
/** Same catch-up as ONCE_CATCH_UP in src/swing/tick.py: stale hour, then one more tick. */
const CATCH_UP_MIN = STALE_MS / 60_000 + INTERVAL_MS / 60_000;

const DEFAULT_START: Record<JobName, string> = {
  premarket: "07:03",
  intraday: "10:03",
  nightly: "16:48",
  report: "17:18",
};
const DEFAULT_INTRADAY_END = "15:48";
const NIGHTLY_SHIFTS: Record<string, string> = {
  "16:48": "13:48",
  "16:37": "13:37",
};

const JOB_LABEL: Record<JobName, string> = {
  premarket: "Premarket",
  intraday: "Intraday",
  nightly: "Nightly",
  report: "Weekly report",
};

export type PcState = "running" | "stalled" | "awake" | "late" | "asleep" | "silent";

export type Heartbeat = {
  status: "running" | "ok" | "failed" | "idle";
  startedAt: string;
  finishedAt: string | null;
  due: string[];
  message: string;
  host: string | null;
};

export type TickRun = {
  id: number;
  job: string;
  step: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown> | null;
  error: string | null;
};

export type StrategyInput = {
  id: string;
  name: string;
  status: string;
  payload: unknown;
};

export type JobOutlook = {
  job: JobName;
  label: string;
  due: boolean;
  queued: boolean;
  when: string;
  reason: string;
};

/** Jobs one active strategy has turned on, each with that strategy's own clock. */
export type StrategyBoard = {
  id: string;
  name: string;
  jobs: JobOutlook[];
};

export type RecentRun = {
  id: number;
  label: string;
  strategy: string;
  status: string;
  when: string;
  note: string;
};

export type TickStatus = {
  configured: boolean;
  readError: boolean;
  state: PcState;
  headline: string;
  detail: string;
  nextAt: string | null;
  nextLabel: string;
  countdown: string;
  pcLabel: string;
  pcHint: string;
  jobsLabel: string;
  jobsHint: string;
  jobs: JobOutlook[];
  boards: StrategyBoard[];
  sessionNote: string | null;
  recent: RecentRun[];
  strategies: string[];
  waiting: boolean;
};

type EtParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
};

type Window = { start: string; end: string | null };

function etParts(instant: Date): EtParts {
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
  for (const part of fmt.formatToParts(instant)) bag[part.type] = part.value;
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    weekday: bag.weekday ?? "",
  };
}

function wallToDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  const shown = etParts(new Date(utc));
  const got = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
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

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function parseHhmm(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function formatCountdown(targetMs: number, nowMs: number): string {
  const secTotal = Math.floor((targetMs - nowMs) / 1000);
  if (secTotal <= 0) return "any moment";
  if (secTotal < 60) return secTotal === 1 ? "in 1 second" : `in ${secTotal} seconds`;
  const min = Math.floor(secTotal / 60);
  const sec = secTotal % 60;
  if (min < 60) return sec ? `in ${min} min ${sec} sec` : `in ${min} min`;
  const hr = Math.floor(min / 60);
  const minRem = min % 60;
  if (hr < 36) return minRem ? `in ${hr} hr ${minRem} min` : `in ${hr} hr`;
  const days = Math.floor(hr / 24);
  return days === 1 ? "in 1 day" : `in ${days} days`;
}

function formatWhen(at: Date, now: Date): string {
  const time = at.toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
  const a = etParts(at);
  const n = etParts(now);
  if (a.year === n.year && a.month === n.month && a.day === n.day) return `${time} ET`;
  const day = at.toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
  return `${day}, ${time} ET`;
}

function formatSpan(startIso: string, finishIso: string | null, now: Date): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return startIso;
  if (!finishIso) return formatWhen(start, now);
  const finish = new Date(finishIso);
  if (Number.isNaN(finish.getTime())) return formatWhen(start, now);
  const a = etParts(start);
  const b = etParts(finish);
  const same = a.year === b.year && a.month === b.month && a.day === b.day;
  if (!same) return formatWhen(start, now);
  const left = start.toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
  const right = finish.toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
  const n = etParts(now);
  const today = a.year === n.year && a.month === n.month && a.day === n.day;
  const clock = `${left}–${right} ET`;
  if (today) return clock;
  const day = start.toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
  return `${day}, ${clock}`;
}

type Session = "weekend" | "closed" | "early" | "open";

function sessionOn(y: number, m: number, d: number): Session {
  const wd = etParts(wallToDate(y, m, d, 12, 0)).weekday;
  if (wd === "Sat" || wd === "Sun") return "weekend";
  const kind = sessionKind(isoDate(y, m, d));
  if (kind === "closed") return "closed";
  if (kind === "early") return "early";
  return "open";
}

function weekdayOf(y: number, m: number, d: number): string {
  return etParts(wallToDate(y, m, d, 12, 0)).weekday;
}

export function nextTickAt(now: Date): Date | null {
  const today = etParts(now);
  let cursor = { y: today.year, m: today.month, d: today.day };
  for (let i = 0; i < 8; i++) {
    if (weekdayOf(cursor.y, cursor.m, cursor.d) !== "Sat" && weekdayOf(cursor.y, cursor.m, cursor.d) !== "Sun") {
      for (const hhmm of TICK_TIMES) {
        const [hour, minute] = hhmm.split(":").map(Number);
        const at = wallToDate(cursor.y, cursor.m, cursor.d, hour, minute);
        if (at.getTime() > now.getTime()) return at;
      }
    }
    cursor = addDays(cursor.y, cursor.m, cursor.d, 1);
  }
  return null;
}

export function lastTickAt(now: Date): Date | null {
  const today = etParts(now);
  let cursor = { y: today.year, m: today.month, d: today.day };
  for (let i = 0; i < 6; i++) {
    if (weekdayOf(cursor.y, cursor.m, cursor.d) !== "Sat" && weekdayOf(cursor.y, cursor.m, cursor.d) !== "Sun") {
      let hit: Date | null = null;
      for (const hhmm of TICK_TIMES) {
        const [hour, minute] = hhmm.split(":").map(Number);
        const at = wallToDate(cursor.y, cursor.m, cursor.d, hour, minute);
        if (at.getTime() <= now.getTime()) hit = at;
      }
      if (hit) return hit;
    }
    cursor = addDays(cursor.y, cursor.m, cursor.d, -1);
  }
  return null;
}

function schedulerOpen(now: Date): boolean {
  const p = etParts(now);
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  const mins = p.hour * 60 + p.minute;
  return mins >= TICK_START && mins <= TICK_END + 5;
}

function clocksOf(payload: unknown): Record<string, { enabled?: unknown; start?: unknown; end?: unknown }> {
  if (!payload || typeof payload !== "object") return {};
  const flow = (payload as { flow?: unknown }).flow;
  if (!flow || typeof flow !== "object") return {};
  const clocks = (flow as { clocks?: unknown }).clocks;
  if (!clocks || typeof clocks !== "object") return {};
  return clocks as Record<string, { enabled?: unknown; start?: unknown; end?: unknown }>;
}

type ClockBag = Record<string, { enabled?: unknown; start?: unknown; end?: unknown }>;

function clockWindow(clocks: ClockBag, job: JobName, early: boolean): Window | null {
  const raw = clocks[job];
  if (!raw || raw.enabled !== true) return null;
  let start = parseHhmm(raw.start, DEFAULT_START[job]);
  if (job === "nightly" && early && NIGHTLY_SHIFTS[start]) start = NIGHTLY_SHIFTS[start];
  const end = job === "intraday" ? parseHhmm(raw.end, DEFAULT_INTRADAY_END) : null;
  return { start, end };
}

function windows(strategies: StrategyInput[], early: boolean): Partial<Record<JobName, Window>> {
  const found: Partial<Record<JobName, Window>> = {};
  for (const row of strategies) {
    if (row.status !== "active") continue;
    const clocks = clocksOf(row.payload);
    for (const job of JOB_ORDER) {
      const window = clockWindow(clocks, job, early);
      if (!window) continue;
      const current = found[job];
      if (!current) {
        found[job] = { ...window };
        continue;
      }
      if (window.start < current.start) current.start = window.start;
      if (window.end && (!current.end || window.end > current.end)) current.end = window.end;
    }
  }
  return found;
}

function ageMs(iso: string, now: Date): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return now.getTime() - t;
}

function onceState(start: string, at: Date): "before" | "open" | "after" {
  const p = etParts(at);
  const nowMin = p.hour * 60 + p.minute;
  const startMin = minutes(start);
  const endMin = startMin + CATCH_UP_MIN;
  if (nowMin < startMin) return "before";
  if (nowMin < endMin) return "open";
  return "after";
}

function inWindow(job: JobName, window: Window, at: Date, early: boolean): boolean {
  const p = etParts(at);
  const nowMin = p.hour * 60 + p.minute;
  if (job === "report" && p.weekday !== "Fri") return false;
  if (job === "intraday") {
    let end = window.end ?? DEFAULT_INTRADAY_END;
    if (early && minutes(end) > minutes("13:00")) end = "13:00";
    if (minutes(end) < minutes(window.start)) return false;
    return minutes(window.start) <= nowMin && nowMin <= minutes(end);
  }
  return onceState(window.start, at) === "open";
}

function slotStartMs(at: Date, start: string): number {
  const p = etParts(at);
  const [hour, minute] = start.split(":").map(Number);
  const origin = wallToDate(p.year, p.month, p.day, hour, minute).getTime();
  if (at.getTime() <= origin) return origin;
  const elapsed = at.getTime() - origin;
  return origin + Math.floor(elapsed / INTERVAL_MS) * INTERVAL_MS;
}

function blockReason(job: JobName, window: Window, runs: TickRun[], at: Date): string | null {
  const p = etParts(at);
  const [hour, minute] = window.start.split(":").map(Number);
  const startAt = wallToDate(p.year, p.month, p.day, hour, minute).getTime();
  const slot = job === "intraday" ? slotStartMs(at, window.start) : null;
  for (const run of runs) {
    if (run.job !== job || run.step) continue;
    const started = new Date(run.startedAt).getTime();
    if (!Number.isFinite(started)) continue;
    const age = at.getTime() - started;
    if (age < 0) continue;
    if (run.status === "running" && age < STALE_MS) return "Already running";
    if (run.status !== "ok") continue;
    if (slot !== null) {
      if (started >= slot) return "Already ran this 15-minute slot";
    } else if (started >= startAt) {
      return "Already finished today";
    }
  }
  return null;
}

function windowText(job: JobName, window: Window, early: boolean): string {
  if (job !== "intraday") return `${clockLabel(window.start)} ET`;
  let end = window.end ?? DEFAULT_INTRADAY_END;
  if (early && minutes(end) > minutes("13:00")) end = "13:00";
  return `${clockLabel(window.start)}–${clockLabel(end)} ET`;
}

function outlook(strategies: StrategyInput[], runs: TickRun[], at: Date, queued: ReadonlySet<string>): JobOutlook[] {
  const p = etParts(at);
  const session = sessionOn(p.year, p.month, p.day);
  const early = session === "early";
  const trading = session === "open" || session === "early";
  const open = windows(strategies, early);
  return JOB_ORDER.map((job) => {
    const window = open[job];
    if (!window) {
      return { job, label: JOB_LABEL[job], due: false, queued: queued.has(job), when: "Off", reason: "Off" };
    }
    return oneJob(job, window, at, early, trading, runs, queued);
  });
}

function oneJob(
  job: JobName,
  window: Window,
  at: Date,
  early: boolean,
  trading: boolean,
  runs: TickRun[],
  queued: ReadonlySet<string>,
): JobOutlook {
  const waiting = queued.has(job);
  const when = windowText(job, window, early);
  if (!trading) {
    return { job, label: JOB_LABEL[job], due: false, queued: waiting, when, reason: "Market is closed" };
  }
  if (!inWindow(job, window, at, early)) {
    const beforeFriday = job === "report" && etParts(at).weekday !== "Fri";
    let reason = `Starts at ${clockLabel(window.start)} ET`;
    if (beforeFriday) reason = "Friday only";
    else if (job === "intraday") reason = `Outside ${when}`;
    else if (onceState(window.start, at) === "after") reason = `Outside ${clockLabel(window.start)} ET`;
    return { job, label: JOB_LABEL[job], due: false, queued: waiting, when, reason };
  }
  const blocked = blockReason(job, window, runs, at);
  if (blocked) return { job, label: JOB_LABEL[job], due: false, queued: waiting, when, reason: blocked };
  return { job, label: JOB_LABEL[job], due: true, queued: waiting, when, reason: "Due" };
}

/** One board per active strategy. A job appears only under strategies that turned it on, with that strategy's clock. */
function strategyBoards(
  strategies: StrategyInput[],
  runs: TickRun[],
  at: Date,
  queued: ReadonlySet<string>,
): StrategyBoard[] {
  const p = etParts(at);
  const session = sessionOn(p.year, p.month, p.day);
  const early = session === "early";
  const trading = session === "open" || session === "early";
  return strategies
    .filter((row) => row.status === "active")
    .map((row) => {
      const clocks = clocksOf(row.payload);
      const jobs = JOB_ORDER.flatMap((job) => {
        const window = clockWindow(clocks, job, early);
        return window ? [oneJob(job, window, at, early, trading, runs, queued)] : [];
      });
      return { id: row.id, name: row.name, jobs };
    });
}

function joiners(strategies: StrategyInput[]): Partial<Record<JobName, string>> {
  const found: Partial<Record<JobName, string[]>> = {};
  for (const row of strategies) {
    if (row.status !== "active") continue;
    const clocks = clocksOf(row.payload);
    for (const job of JOB_ORDER) {
      if (clocks[job]?.enabled !== true) continue;
      const list = found[job] ?? [];
      list.push(row.name);
      found[job] = list;
    }
  }
  const labeled: Partial<Record<JobName, string>> = {};
  for (const job of JOB_ORDER) {
    const names = found[job];
    if (names?.length) labeled[job] = names.join(", ");
  }
  return labeled;
}

function jobLevel(runs: TickRun[]): TickRun[] {
  return runs.filter((run) => !run.step);
}

function liveRuns(runs: TickRun[], now: Date): TickRun[] {
  return jobLevel(runs).filter((run) => run.status === "running" && ageMs(run.startedAt, now) < STALE_MS);
}

function names(jobs: string[]): string {
  const labels = jobs.map((job) => JOB_LABEL[job as JobName] ?? job);
  return labels.join(", ");
}

function parseStatus(value: unknown): Heartbeat["status"] | null {
  if (value === "running" || value === "ok" || value === "failed" || value === "idle") return value;
  return null;
}

export function parseHeartbeat(value: unknown, updatedAt: string | null): Heartbeat | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const status = parseStatus(row.status);
  const startedAt = typeof row.started_at === "string" ? row.started_at : updatedAt;
  if (!status || !startedAt) return null;
  return {
    status,
    startedAt,
    finishedAt: typeof row.finished_at === "string" ? row.finished_at : null,
    due: Array.isArray(row.due) ? row.due.map(String) : [],
    message: typeof row.message === "string" ? row.message : "",
    host: typeof row.host === "string" && row.host ? row.host : null,
  };
}

function pcState(now: Date, beat: Heartbeat | null, live: boolean): PcState {
  if (beat?.status === "running" && ageMs(beat.startedAt, now) < STALE_MS) return "running";
  if (beat?.status === "running") return "stalled";
  if (live && !beat) return "running";
  if (!beat) return "silent";
  if (!schedulerOpen(now)) return "asleep";
  const slot = lastTickAt(now);
  const seen = new Date(beat.finishedAt ?? beat.startedAt).getTime();
  if (slot && now.getTime() > slot.getTime() + GRACE_MS && seen < slot.getTime() - SLOT_SKEW_MS) return "late";
  return "awake";
}

const PC_LABEL: Record<PcState, string> = {
  running: "Running",
  stalled: "Stalled",
  awake: "Idle",
  late: "Missed",
  asleep: "Asleep",
  silent: "Unknown",
};

function recentRows(runs: TickRun[], now: Date, owners: Partial<Record<JobName, string>>): RecentRun[] {
  return jobLevel(runs)
    .slice()
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime() || b.id - a.id)
    .slice(0, 12)
    .map((run) => {
      const stale = run.status === "running" && ageMs(run.startedAt, now) >= STALE_MS;
      const status = stale ? "stalled" : run.status;
      const step = typeof run.summary?.current === "string" ? run.summary.current : null;
      const note = run.error?.trim() || (step ? stepTitle(run.job, step) : "");
      const strategy = isJobName(run.job) ? owners[run.job] : undefined;
      return {
        id: run.id,
        label: JOB_LABEL[run.job as JobName] ?? run.job,
        strategy: strategy || "—",
        status,
        when: formatSpan(run.startedAt, run.finishedAt, now),
        note,
      };
    });
}

function emptyStatus(now: Date, configured: boolean, readError: boolean): TickStatus {
  const next = nextTickAt(now);
  const nextLabel = next ? formatWhen(next, now) : "—";
  return {
    configured,
    readError,
    state: "silent",
    headline: configured ? "Could not read the journal" : "Connect Neon to see the job PC",
    detail: configured
      ? "The next tick time is still on the schedule. The check-in and job list need the database."
      : `Next tick ${nextLabel}. Add DATABASE_URL so this page can read the PC check-in.`,
    nextAt: next ? next.toISOString() : null,
    nextLabel,
    countdown: next ? formatCountdown(next.getTime(), now.getTime()) : "—",
    pcLabel: "Unknown",
    pcHint: configured ? "journal unread" : "no database",
    jobsLabel: "Unknown",
    jobsHint: "journal unread",
    jobs: [],
    boards: [],
    sessionNote: null,
    recent: [],
    strategies: [],
    waiting: false,
  };
}

export function buildTickStatus(input: {
  configured: boolean;
  readError?: boolean;
  now?: Date;
  heartbeat: Heartbeat | null;
  strategies: StrategyInput[];
  runs: TickRun[];
  queued?: string[];
}): TickStatus {
  const now = input.now ?? new Date();
  if (!input.configured || input.readError) return emptyStatus(now, input.configured, Boolean(input.readError));

  const next = nextTickAt(now);
  const nextLabel = next ? formatWhen(next, now) : "—";
  const live = liveRuns(input.runs, now);
  const state = pcState(now, input.heartbeat, live.length > 0);
  const queued = new Set(input.queued ?? []);
  const jobs = next ? outlook(input.strategies, input.runs, next, queued) : [];
  const boards = next ? strategyBoards(input.strategies, input.runs, next, queued) : [];
  const owners = joiners(input.strategies);
  const due = jobs.filter((job) => job.due).map((job) => job.label);
  const queuedLabels = jobs.filter((job) => job.queued).map((job) => job.label);
  const active = input.strategies.filter((row) => row.status === "active").map((row) => row.name);
  const beat = input.heartbeat;
  const seenIso = beat ? beat.finishedAt ?? beat.startedAt : live[0]?.startedAt ?? null;
  const seen = seenIso ? formatWhen(new Date(seenIso), now) : null;
  const host = beat?.host ?? null;
  const slot = lastTickAt(now);
  const slotLabel = slot ? formatWhen(slot, now) : null;

  const runningIds = state === "running" ? (live.length ? live.map((run) => run.job) : (beat?.due ?? [])) : [];
  const runningLabel = names(runningIds);

  let headline = "The job PC is idle";
  let detail = next ? `Next tick ${nextLabel}.` : "No upcoming tick.";
  if (state === "running") {
    headline = "Swing Tick is running";
    const what = runningLabel || "Checking which jobs are due";
    detail = seen ? `${what} since ${seen}.` : `${what}.`;
  } else if (state === "stalled") {
    headline = "Swing Tick stalled";
    detail = seen ? `It started at ${seen} and did not finish within an hour.` : "A tick started and did not finish within an hour.";
  } else if (state === "late") {
    headline = "The job PC missed a tick";
    detail = slotLabel
      ? `The ${slotLabel} tick did not report.${seen ? ` Last check-in was ${seen}.` : ""}`
      : "A scheduled tick did not report.";
  } else if (state === "asleep") {
    headline = "The job PC is asleep";
    detail = `Next tick ${nextLabel}. Swing Tick stays quiet overnight and on weekends.`;
    if (beat?.status === "failed") detail = `The last tick failed. ${detail}`;
  } else if (state === "silent") {
    headline = "The job PC has not checked in";
    detail = `Next tick ${nextLabel}. Each tick writes a check-in, including ticks that start no job.`;
  } else if (beat?.status === "failed") {
    headline = "The last tick failed";
    detail = `${seen ? `At ${seen}. ` : ""}${beat.message || "It will try again on the next tick."}`;
  } else if (due.length) {
    detail = `Next tick ${nextLabel}. ${due.join(", ")} ${due.length === 1 ? "is" : "are"} due.`;
  } else if (queuedLabels.length) {
    detail = `Next tick ${nextLabel}.`;
  } else if (jobs.some((job) => job.reason === "Market is closed")) {
    detail = `Next tick ${nextLabel}. The market is closed, so the tick wakes up and exits.`;
  } else {
    detail = `Next tick ${nextLabel}. Nothing is due.`;
  }

  const seenMs = seenIso ? new Date(seenIso).getTime() : NaN;
  const waiting =
    state === "awake" &&
    Boolean(slot) &&
    Number.isFinite(seenMs) &&
    seenMs < slot!.getTime() - SLOT_SKEW_MS;

  if (waiting) {
    headline = "Waiting on this tick";
    detail = `The ${slotLabel} tick has not reported yet.${seen ? ` Last check-in was ${seen}.` : ""}`;
  }
  if (queuedLabels.length) {
    const verb = queuedLabels.length === 1 ? "is" : "are";
    detail = `${detail.replace(/\.\s*$/, "")}. ${queuedLabels.join(", ")} ${verb} queued for the next tick.`;
  }
  if (host && state !== "silent") detail = `${detail.replace(/\.\s*$/, "")} on ${host}.`;

  let jobsLabel = "None";
  let jobsHint = "nothing due";
  if (state === "running") {
    jobsLabel = runningLabel || "Checking";
    jobsHint = runningLabel ? "running now" : "this tick";
  } else if (due.length) {
    jobsLabel = due.join(", ");
    jobsHint = "on the next tick";
  } else if (queuedLabels.length) {
    jobsLabel = queuedLabels.join(", ");
    jobsHint = "queued for the next tick";
  } else if (jobs.some((job) => job.reason === "Market is closed")) {
    jobsHint = "market is closed";
  } else if (jobs.length && jobs.every((job) => job.reason === "Off")) {
    jobsHint = "nothing turned on";
  }

  const nextParts = next ? etParts(next) : null;
  const nextSession = nextParts ? sessionOn(nextParts.year, nextParts.month, nextParts.day) : null;
  const sessionNote =
    nextSession === "early" ? "Early close. The cash session ends at 1:00 PM ET, and the default nightly tick moves to 1:48 PM ET." : null;

  let pcHint = "no check-in yet";
  if (state === "running") pcHint = seen ? `since ${seen}` : "in progress";
  else if (state === "stalled") pcHint = seen ? `started ${seen}` : "no finish";
  else if (state === "late") pcHint = slotLabel ? `missed ${slotLabel}` : "missed a tick";
  else if (state === "asleep") pcHint = next ? `wakes ${nextLabel}` : "outside the window";
  else if (waiting) pcHint = slotLabel ? `due ${slotLabel}` : "due now";
  else if (state === "awake") pcHint = seen ? `last tick ${seen}` : "checked in";
  if (host && (state === "awake" || state === "running" || state === "late" || state === "stalled")) {
    pcHint = `${host} · ${pcHint}`;
  }

  return {
    configured: true,
    readError: false,
    state,
    headline,
    detail,
    nextAt: next ? next.toISOString() : null,
    nextLabel,
    countdown: next ? formatCountdown(next.getTime(), now.getTime()) : "—",
    pcLabel: waiting ? "Waiting" : PC_LABEL[state],
    pcHint,
    jobsLabel,
    jobsHint,
    jobs,
    boards,
    sessionNote,
    recent: recentRows(input.runs, now, owners),
    strategies: active,
    waiting,
  };
}
