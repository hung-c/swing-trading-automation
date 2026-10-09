export type Bar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type Frame = "daily" | "weekly" | "intraday";

export type PatternKind = "box" | "flag" | "triangle" | "cup";

export type Anchor = {
  id: string;
  t: number;
  price: number;
  label: string;
};

export type LevelId = "resistance" | "entry" | "stop" | "target2r" | "target3r" | "alert";

export type IndicatorId = "ema8" | "ema21" | "sma50" | "sma200" | "sma30" | "vwap";

export type ChartLevels = Record<LevelId, number>;

export const LEVELS: { id: LevelId; name: string; color: string; dash: number[] }[] = [
  { id: "resistance", name: "Resistance", color: "#e6b450", dash: [5, 4] },
  { id: "entry", name: "Entry", color: "#3dcf8e", dash: [] },
  { id: "stop", name: "Stop", color: "#ef6b73", dash: [] },
  { id: "target2r", name: "2R", color: "#6cb6ff", dash: [] },
  { id: "target3r", name: "3R", color: "#8eb6d9", dash: [2, 3] },
  { id: "alert", name: "Alert", color: "#d4a017", dash: [2, 3] },
];

export const INDICATORS: { id: IndicatorId; color: string; period: boolean; fallback: number }[] = [
  { id: "ema8", color: "#e07070", period: true, fallback: 8 },
  { id: "ema21", color: "#b794f6", period: true, fallback: 21 },
  { id: "sma50", color: "#6cb6ff", period: true, fallback: 50 },
  { id: "sma200", color: "#5dcaa5", period: true, fallback: 200 },
  { id: "sma30", color: "#7eb6ff", period: true, fallback: 30 },
  { id: "vwap", color: "#e6b450", period: false, fallback: 0 },
];

export const DEFAULT_PERIODS: Record<IndicatorId, number> = {
  ema8: 8,
  ema21: 21,
  sma50: 50,
  sma200: 200,
  sma30: 30,
  vwap: 0,
};

const etDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const etDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const etStamp = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const etAxisDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});

const etAxisMonth = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  year: "2-digit",
});

const etAxisTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
});

export function formatBarTime(t: number, frame: Frame): string {
  const d = new Date(t);
  return frame === "intraday" ? etStamp.format(d) : etDate.format(d);
}

export function formatAxisTime(t: number, frame: Frame, span: number): string {
  const d = new Date(t);
  if (frame === "intraday") return etAxisTime.format(d);
  if (span > 180) return etAxisMonth.format(d);
  return etAxisDay.format(d);
}

export function formatPx(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const digits = Math.abs(n) >= 1000 ? 1 : 2;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatVol(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (n < 2) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (n < 2 || values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = 0;
  for (let i = 0; i < n; i++) prev += values[i];
  prev /= n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function sessionVwap(bars: Bar[]): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  let day = "";
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const d = etDay.format(new Date(b.t));
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
    out[i] = vol > 0 ? pv / vol : typical;
  }
  return out;
}

export function indicatorName(id: IndicatorId, period: number): string {
  if (id === "vwap") return "VWAP";
  if (id === "ema8" || id === "ema21") return `EMA ${period}`;
  return `SMA ${period}`;
}

export function computeLine(bars: Bar[], id: IndicatorId, period: number): (number | null)[] {
  if (id === "vwap") return sessionVwap(bars);
  const close = bars.map((b) => b.c);
  if (id === "ema8" || id === "ema21") return ema(close, period);
  return sma(close, period);
}

export function patternKindFor(name: string): PatternKind {
  if (name === "bull_flag") return "flag";
  if (name === "ascending_triangle") return "triangle";
  if (name === "cup_handle") return "cup";
  return "box";
}

export function shapeLabel(kind: PatternKind, planPattern: string): string {
  if (kind === "flag") return "Bull flag";
  if (kind === "triangle") return "Ascending triangle";
  if (kind === "cup") return "Cup with handle";
  if (planPattern === "generic_base") return "Base";
  return "Flat base";
}

export function defaultOn(id: string, frame: Frame): boolean {
  if (id === "volume" || id === "pattern" || id === "resistance" || id === "entry" || id === "stop" || id === "target2r") {
    return true;
  }
  if (id === "target3r" || id === "alert") return frame === "daily";
  if (frame === "weekly") return id === "sma30";
  if (frame === "intraday") return id === "vwap" || id === "ema8" || id === "ema21";
  return id === "ema8" || id === "ema21" || id === "sma50" || id === "sma200";
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  if (!(step > 0)) return [min, max];
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-6 && ticks.length < 12; v += step) {
    ticks.push(Number(v.toFixed(8)));
  }
  return ticks;
}

export function indexAtTime(bars: Bar[], t: number): number {
  if (!bars.length) return 0;
  if (t <= bars[0].t) return 0;
  if (t >= bars[bars.length - 1].t) return bars.length - 1;
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const span = bars[hi].t - bars[lo].t || 1;
  return lo + (t - bars[lo].t) / span;
}

export function timeAtIndex(bars: Bar[], i: number): number {
  if (!bars.length) return 0;
  if (i <= 0) return bars[0].t;
  if (i >= bars.length - 1) return bars[bars.length - 1].t;
  const lo = Math.floor(i);
  const hi = Math.min(bars.length - 1, lo + 1);
  const f = i - lo;
  return bars[lo].t + (bars[hi].t - bars[lo].t) * f;
}

function localLows(bars: Bar[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(from, 2); i <= Math.min(to, bars.length - 3); i++) {
    const v = bars[i].l;
    if (v <= bars[i - 1].l && v <= bars[i - 2].l && v <= bars[i + 1].l && v <= bars[i + 2].l) out.push(i);
  }
  return out;
}

function inferBox(bars: Bar[], resistance: number, stop: number): Anchor[] {
  const last = bars.length - 1;
  const ceiling = resistance > 0 ? resistance : bars[last].h;
  let bestStart = Math.max(0, last - 20);
  for (let len = 8; len <= Math.min(70, last); len++) {
    const start = last - len + 1;
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = start; i <= last; i++) {
      hi = Math.max(hi, bars[i].h);
      lo = Math.min(lo, bars[i].l);
    }
    const depth = hi > 0 ? (hi - lo) / hi : 1;
    const near = Math.abs(hi - ceiling) / ceiling < 0.08 || hi <= ceiling * 1.04;
    const aboveStop = stop <= 0 || lo >= stop * 0.94;
    if (depth <= 0.2 && near && aboveStop) bestStart = start;
    else if (len > 18) break;
  }
  let baseLow = Infinity;
  for (let i = bestStart; i <= last; i++) baseLow = Math.min(baseLow, bars[i].l);
  return [
    { id: "a", t: bars[bestStart].t, price: ceiling, label: "Base start" },
    { id: "b", t: bars[last].t, price: Number.isFinite(baseLow) ? baseLow : stop || bars[last].l, label: "Base low" },
  ];
}

function inferFlag(bars: Bar[], resistance: number): Anchor[] {
  const last = bars.length - 1;
  const ceiling = resistance > 0 ? resistance : bars[last].h;
  const searchFrom = Math.max(0, last - 50);
  let topI = searchFrom;
  let best = Infinity;
  for (let i = searchFrom; i <= last; i++) {
    const d = Math.abs(bars[i].h - ceiling);
    if (d < best) {
      best = d;
      topI = i;
    }
  }
  let lowI = Math.max(0, topI - 35);
  for (let i = lowI; i <= topI; i++) if (bars[i].l < bars[lowI].l) lowI = i;
  let flagLow = bars[topI].l;
  for (let i = topI + 1; i <= last; i++) flagLow = Math.min(flagLow, bars[i].l);
  const flagHigh = Math.min(bars[topI].h, Math.max(bars[last].h, bars[last].c));
  return [
    { id: "pole", t: bars[lowI].t, price: bars[lowI].l, label: "Pole start" },
    { id: "top", t: bars[topI].t, price: bars[topI].h, label: "Pole top" },
    { id: "upper", t: bars[last].t, price: flagHigh, label: "Flag high" },
    { id: "lower", t: bars[last].t, price: flagLow, label: "Flag low" },
  ];
}

function inferTriangle(bars: Bar[], resistance: number, stop: number): Anchor[] {
  const last = bars.length - 1;
  const ceiling = resistance > 0 ? resistance : bars[last].h;
  const from = Math.max(0, last - 65);
  const lows = localLows(bars, from, last).filter((i) => stop <= 0 || bars[i].l >= stop * 0.92);
  const left = lows[0] ?? from;
  const right = lows.length > 1 ? lows[lows.length - 1] : Math.min(last, left + Math.max(8, Math.floor((last - left) / 2)));
  return [
    { id: "left", t: bars[left].t, price: bars[left].l, label: "Left low" },
    { id: "right", t: bars[right].t, price: bars[right].l, label: "Right low" },
    { id: "top", t: bars[Math.min(left, from)].t, price: ceiling, label: "Flat top" },
    { id: "topEnd", t: bars[last].t, price: ceiling, label: "Top end" },
  ];
}

function inferCup(bars: Bar[], resistance: number): Anchor[] {
  const last = bars.length - 1;
  const ceiling = resistance > 0 ? resistance : bars[last].h;
  const from = Math.max(0, last - 130);
  const rightEnd = Math.max(from + 5, last - 4);
  let right = rightEnd;
  let best = Infinity;
  for (let i = Math.floor((from + last) / 2); i <= rightEnd; i++) {
    const d = Math.abs(bars[i].h - ceiling);
    if (d < best) {
      best = d;
      right = i;
    }
  }
  let trough = from;
  for (let i = from; i <= right; i++) if (bars[i].l < bars[trough].l) trough = i;
  let left = from;
  best = Infinity;
  for (let i = from; i < Math.max(from + 1, trough); i++) {
    const d = Math.abs(bars[i].h - bars[right].h);
    if (d < best) {
      best = d;
      left = i;
    }
  }
  let handle = last;
  let handleLow = Infinity;
  for (let i = right + 1; i <= last; i++) {
    if (bars[i].l < handleLow) {
      handleLow = bars[i].l;
      handle = i;
    }
  }
  if (!Number.isFinite(handleLow)) {
    handle = last;
    handleLow = bars[last].l;
  }
  return [
    { id: "left", t: bars[left].t, price: Math.max(bars[left].h, ceiling * 0.97), label: "Left rim" },
    { id: "trough", t: bars[trough].t, price: bars[trough].l, label: "Cup low" },
    { id: "right", t: bars[right].t, price: Math.max(bars[right].h, ceiling * 0.97), label: "Right rim" },
    { id: "handle", t: bars[handle].t, price: handleLow, label: "Handle" },
  ];
}

export function inferPattern(bars: Bar[], kind: PatternKind, resistance: number, stop: number): Anchor[] {
  if (bars.length < 5) return [];
  if (kind === "flag") return inferFlag(bars, resistance);
  if (kind === "triangle") return inferTriangle(bars, resistance, stop);
  if (kind === "cup") return inferCup(bars, resistance);
  return inferBox(bars, resistance, stop);
}

export function clampWindow(i0: number, i1: number, n: number): { i0: number; i1: number } {
  const span = Math.max(8, i1 - i0);
  let a = i0;
  let b = i0 + span;
  if (b < 6) {
    a = 6 - span;
    b = 6;
  }
  if (a > n - 4) {
    a = n - 4;
    b = a + span;
  }
  return { i0: a, i1: b };
}
