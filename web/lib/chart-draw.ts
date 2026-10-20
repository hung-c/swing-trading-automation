import type { Anchor, Bar, Frame, PatternKind } from "./chart-math";
import { clampWindow, formatAxisTime, formatPx, indexAtTime, niceTicks, patternViewStart, timeAtIndex } from "./chart-math";

export type View = { i0: number; i1: number; y0: number; y1: number; yAuto: boolean };

export type LineSeries = { id: string; name: string; color: string; values: (number | null)[] };

export type LevelMark = { id: string; name: string; color: string; dash: number[]; price: number };

export type PatternMark = { kind: PatternKind; label: string; anchors: Anchor[] };

export type DrawInput = {
  bars: Bar[];
  frame: Frame;
  view: View | null;
  width: number;
  height: number;
  lines: LineSeries[];
  levels: LevelMark[];
  pattern: PatternMark | null;
  showVolume: boolean;
  hotId: string | null;
  pointer: { x: number; y: number } | null;
};

type Rect = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

export type Measure = {
  view: View;
  price: Rect;
  vol: Rect;
  padB: number;
  xOf: (i: number) => number;
  yOf: (p: number) => number;
  iAt: (x: number) => number;
  pAt: (y: number) => number;
};

export type Hit =
  | { type: "line"; id: string; i: number }
  | { type: "level"; id: string; i: number }
  | { type: "pattern"; i: number }
  | { type: "volume"; i: number }
  | { type: "candle"; i: number }
  | { type: "price-scale" }
  | { type: "time-scale" }
  | { type: "plot"; i: number };

const UP = "#3dcf8e";
const DOWN = "#ef6b73";
const GRID = "#243040";
const MUTED = "#8b9bb0";
const BG = "#10161c";
const PATTERN = "#7eb6ff";

function yRange(bars: Bar[], i0: number, i1: number, extras: number[]): { y0: number; y1: number } {
  let lo = Infinity;
  let hi = -Infinity;
  const a = Math.max(0, Math.floor(i0));
  const b = Math.min(bars.length - 1, Math.ceil(i1));
  for (let i = a; i <= b; i++) {
    lo = Math.min(lo, bars[i].l);
    hi = Math.max(hi, bars[i].h);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { y0: 0, y1: 1 };
  const span = Math.max(hi - lo, Math.abs(hi) * 0.01, 0.05);
  for (const p of extras) {
    if (p > lo - span && p < hi + span) {
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
  }
  const pad = Math.max(hi - lo, 0.05) * 0.08;
  return { y0: lo - pad, y1: hi + pad };
}

export function resolveView(input: DrawInput, extras: number[]): View | null {
  const { bars, view, frame } = input;
  if (!bars.length) return null;
  if (!view) {
    const anchors = input.pattern?.anchors ?? [];
    const i1 = bars.length - 1 + 1.2;
    const i0 = anchors.length
      ? indexAtTime(bars, patternViewStart(anchors, bars[bars.length - 1].t)) - 0.6
      : i1 - Math.min(frame === "daily" ? 130 : frame === "weekly" ? 160 : Math.max(20, bars.length), bars.length + 2);
    const next = clampWindow(i0, i1, bars.length);
    return { ...next, ...yRange(bars, next.i0, next.i1, extras), yAuto: true };
  }
  if (!view.yAuto) return view;
  return { ...view, ...yRange(bars, view.i0, view.i1, extras) };
}

export function measure(input: DrawInput): Measure | null {
  if (input.width < 20 || input.height < 20 || !input.bars.length) return null;
  const extras = [
    ...input.levels.map((l) => l.price),
    ...(input.pattern?.anchors.map((a) => a.price) ?? []),
  ];
  const view = resolveView(input, extras);
  if (!view) return null;
  const padL = 10;
  const padR = 70;
  const padT = 12;
  const padB = 26;
  const gap = 8;
  const volH = input.showVolume ? Math.max(40, Math.round((input.height - padT - padB) * 0.18)) : 0;
  const priceH = input.height - padT - padB - volH - (input.showVolume ? gap : 0);
  const price: Rect = { x: padL, y: padT, w: Math.max(10, input.width - padL - padR), h: Math.max(10, priceH) };
  const vol: Rect = { x: padL, y: padT + priceH + gap, w: price.w, h: volH };
  const span = view.i1 - view.i0 || 1;
  const ySpan = view.y1 - view.y0 || 1;
  return {
    view,
    price,
    vol,
    padB,
    xOf: (i) => price.x + ((i - view.i0) / span) * price.w,
    yOf: (p) => price.y + (1 - (p - view.y0) / ySpan) * price.h,
    iAt: (x) => view.i0 + ((x - price.x) / price.w) * span,
    pAt: (y) => view.y0 + (1 - (y - price.y) / price.h) * ySpan,
  };
}

function barAt(m: Measure, x: number, n: number): number {
  return Math.max(0, Math.min(n - 1, Math.round(m.iAt(x))));
}

function distToSeg(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - a.x, py - a.y);
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function placed(m: Measure, bars: Bar[], anchors: Anchor[]) {
  const map = new Map<string, { x: number; y: number; price: number }>();
  for (const a of anchors) {
    const i = indexAtTime(bars, a.t);
    map.set(a.id, { x: m.xOf(i), y: m.yOf(a.price), price: a.price });
  }
  return map;
}

function quad(p0: Point, p1: Point, p2: Point, n = 28): Point[] {
  const cx = 2 * p1.x - 0.5 * p0.x - 0.5 * p2.x;
  const cy = 2 * p1.y - 0.5 * p0.y - 0.5 * p2.y;
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({
      x: u * u * p0.x + 2 * u * t * cx + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * cy + t * t * p2.y,
    });
  }
  return pts;
}

type Shape = { fill: Point[] | null; strokes: Point[][]; labelAt: Point | null };

function patternShape(m: Measure, bars: Bar[], pattern: PatternMark): Shape {
  const map = placed(m, bars, pattern.anchors);
  const need = (...ids: string[]) => ids.map((id) => map.get(id));
  if (pattern.kind === "box") {
    const [a, b] = need("a", "b");
    if (!a || !b) return { fill: null, strokes: [], labelAt: null };
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    const yTop = Math.min(a.y, b.y);
    const yBot = Math.max(a.y, b.y);
    const fill = [
      { x: x1, y: yTop },
      { x: x2, y: yTop },
      { x: x2, y: yBot },
      { x: x1, y: yBot },
    ];
    return { fill, strokes: [fill.concat(fill[0])], labelAt: { x: x1, y: yTop } };
  }
  if (pattern.kind === "flag") {
    const pole = map.get("pole");
    const top = map.get("top");
    const upper = map.get("upper");
    const lower = map.get("lower");
    if (!pole || !top || !upper || !lower) return { fill: null, strokes: [], labelAt: null };
    const lowerStart = { x: top.x, y: m.yOf(top.price - (upper.price - lower.price)) };
    const channel = [top, upper, lower, lowerStart];
    return {
      fill: channel,
      strokes: [
        [pole, top],
        [top, upper],
        [lowerStart, lower],
      ],
      labelAt: pole,
    };
  }
  if (pattern.kind === "triangle") {
    const left = map.get("left");
    const right = map.get("right");
    const top = map.get("top");
    const topEnd = map.get("topEnd");
    if (!left || !right || !top || !topEnd) return { fill: null, strokes: [], labelAt: null };
    return {
      fill: [top, topEnd, right, left],
      strokes: [
        [top, topEnd],
        [left, right],
      ],
      labelAt: top,
    };
  }
  const left = map.get("left");
  const trough = map.get("trough");
  const right = map.get("right");
  const handle = map.get("handle");
  if (!left || !trough || !right || !handle) return { fill: null, strokes: [], labelAt: null };
  const curve = quad(left, trough, right);
  const lip = { x: m.xOf(bars.length - 1), y: right.y };
  const handleStroke = Math.abs(handle.x - lip.x) < 2 ? [right, handle] : [right, handle, lip];
  return { fill: curve, strokes: [curve, handleStroke], labelAt: left };
}

function strokePath(ctx: CanvasRenderingContext2D, pts: Point[]) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function fillPath(ctx: CanvasRenderingContext2D, pts: Point[]) {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
}

function roundTag(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clip(ctx: CanvasRenderingContext2D, r: Rect) {
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
}

export function hitTest(input: DrawInput, x: number, y: number): Hit | null {
  const m = measure(input);
  if (!m) return null;
  const n = input.bars.length;
  const { price, vol, view } = m;
  if (x >= price.x + price.w && y >= price.y && y <= price.y + price.h) return { type: "price-scale" };
  if (y >= input.height - m.padB && x >= price.x && x <= price.x + price.w) return { type: "time-scale" };
  const insideX = x >= price.x && x <= price.x + price.w;
  const inPrice = insideX && y >= price.y && y <= price.y + price.h;
  const inVol = input.showVolume && insideX && y >= vol.y && y <= vol.y + vol.h;
  if (!inPrice && !inVol) return null;
  const i = barAt(m, x, n);
  if (!inPrice) return { type: "volume", i };

  let bestD = 8;
  let best: Hit | null = null;
  const consider = (d: number, hit: Hit) => {
    if (d < bestD) {
      bestD = d;
      best = hit;
    }
  };

  for (const level of input.levels) {
    consider(Math.abs(y - m.yOf(level.price)), { type: "level", id: level.id, i });
  }
  const i0 = Math.max(0, Math.floor(view.i0) - 1);
  const i1 = Math.min(n - 1, Math.ceil(view.i1) + 1);
  for (const line of input.lines) {
    let prev: Point | null = null;
    for (let k = i0; k <= i1; k++) {
      const v = line.values[k];
      if (v == null) {
        prev = null;
        continue;
      }
      const pt = { x: m.xOf(k), y: m.yOf(v) };
      if (prev) consider(distToSeg(x, y, prev, pt), { type: "line", id: line.id, i });
      prev = pt;
    }
  }
  if (input.pattern) {
    const shape = patternShape(m, input.bars, input.pattern);
    for (const stroke of shape.strokes) {
      for (let k = 1; k < stroke.length; k++) {
        consider(distToSeg(x, y, stroke[k - 1], stroke[k]), { type: "pattern", i });
      }
    }
  }
  return best ?? { type: "candle", i };
}

export function paint(canvas: HTMLCanvasElement, input: DrawInput) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(input.width);
  const h = Math.round(input.height);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const m = measure(input);
  if (!m) return;
  draw(ctx, input, m);
}

function draw(ctx: CanvasRenderingContext2D, input: DrawInput, m: Measure) {
  const { bars, frame, lines, levels, pattern, hotId, pointer, showVolume } = input;
  const { price, vol, view } = m;
  const i0 = Math.max(0, Math.floor(view.i0));
  const i1 = Math.min(bars.length - 1, Math.ceil(view.i1));

  ctx.font = '11px "IBM Plex Sans", sans-serif';
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.fillStyle = MUTED;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tick of niceTicks(view.y0, view.y1, 5)) {
    const y = m.yOf(tick);
    if (y < price.y || y > price.y + price.h) continue;
    ctx.beginPath();
    ctx.moveTo(price.x, y);
    ctx.lineTo(price.x + price.w, y);
    ctx.stroke();
    ctx.fillText(formatPx(tick), price.x + price.w + 58, y);
  }

  const shape = pattern ? patternShape(m, bars, pattern) : null;
  ctx.save();
  clip(ctx, price);
  if (shape?.fill) {
    ctx.fillStyle = "rgba(126, 182, 255, 0.13)";
    fillPath(ctx, shape.fill);
  }

  const slot = price.w / Math.max(view.i1 - view.i0, 1);
  const cw = Math.max(0.45, Math.min(12, slot * 0.66));
  ctx.lineWidth = 1;
  for (let i = i0; i <= i1; i++) {
    const b = bars[i];
    const x = m.xOf(i);
    const up = b.c >= b.o;
    ctx.strokeStyle = up ? UP : DOWN;
    ctx.fillStyle = up ? UP : DOWN;
    ctx.beginPath();
    ctx.moveTo(x, m.yOf(b.h));
    ctx.lineTo(x, m.yOf(b.l));
    ctx.stroke();
    const yO = m.yOf(b.o);
    const yC = m.yOf(b.c);
    ctx.fillRect(x - cw / 2, Math.min(yO, yC), cw, Math.max(1, Math.abs(yC - yO)));
  }

  const drawLine = (line: LineSeries, hot: boolean) => {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = hot ? 2.3 : 1.35;
    ctx.beginPath();
    let started = false;
    for (let i = i0; i <= i1; i++) {
      const v = line.values[i];
      if (v == null) {
        started = false;
        continue;
      }
      const x = m.xOf(i);
      const y = m.yOf(v);
      if (!started) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      started = true;
    }
    ctx.stroke();
  };
  for (const line of lines) if (line.id !== hotId) drawLine(line, false);
  for (const line of lines) if (line.id === hotId) drawLine(line, true);

  if (shape) {
    ctx.strokeStyle = hotId === "pattern" ? "#e7f2ff" : PATTERN;
    ctx.lineWidth = hotId === "pattern" ? 2.2 : 1.5;
    ctx.setLineDash([]);
    for (const stroke of shape.strokes) strokePath(ctx, stroke);
    if (shape.labelAt) {
      ctx.font = '12px "IBM Plex Sans", sans-serif';
      ctx.fillStyle = hotId === "pattern" ? "#e7f2ff" : "#b9d7ff";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const lx = Math.min(Math.max(shape.labelAt.x + 6, price.x + 4), price.x + price.w - 120);
      const ly = Math.min(Math.max(shape.labelAt.y + 6, price.y + 4), price.y + price.h - 18);
      ctx.fillText(pattern?.label ?? "", lx, ly);
    }
  }

  for (const level of levels) {
    const y = m.yOf(level.price);
    if (y < price.y - 2 || y > price.y + price.h + 2) continue;
    ctx.strokeStyle = level.color;
    ctx.lineWidth = hotId === level.id ? 2.1 : 1;
    ctx.setLineDash(level.dash);
    ctx.beginPath();
    ctx.moveTo(price.x, y);
    ctx.lineTo(price.x + price.w, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  if (showVolume && vol.h > 4) {
    let vMax = 1;
    for (let i = i0; i <= i1; i++) vMax = Math.max(vMax, bars[i].v);
    ctx.save();
    clip(ctx, vol);
    for (let i = i0; i <= i1; i++) {
      const b = bars[i];
      const vh = (b.v / vMax) * (vol.h - 2);
      ctx.fillStyle = b.c >= b.o ? "rgba(61, 207, 142, 0.45)" : "rgba(239, 107, 115, 0.45)";
      ctx.fillRect(m.xOf(i) - cw / 2, vol.y + vol.h - vh, cw, vh);
    }
    ctx.restore();
  }

  ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = MUTED;
  const ticks = Math.max(2, Math.floor(price.w / 96));
  let lastX = -999;
  for (let s = 0; s <= ticks; s++) {
    const i = view.i0 + (s / ticks) * (view.i1 - view.i0);
    const x = m.xOf(i);
    if (x < price.x || x > price.x + price.w || x - lastX < 56) continue;
    lastX = x;
    ctx.fillText(formatAxisTime(timeAtIndex(bars, i), frame, view.i1 - view.i0), x, input.height - 16);
  }

  const tags: { y: number; color: string; text: string }[] = [];
  for (const level of levels) {
    const y = m.yOf(level.price);
    if (y < price.y || y > price.y + price.h) continue;
    tags.push({ y, color: level.color, text: `${level.name} ${formatPx(level.price)}` });
  }
  tags.sort((a, b) => a.y - b.y);
  for (let i = 1; i < tags.length; i++) if (tags[i].y < tags[i - 1].y + 15) tags[i].y = tags[i - 1].y + 15;
  for (let i = tags.length - 1; i >= 0; i--) {
    const limit = price.y + price.h - 8;
    if (tags[i].y > limit) tags[i].y = limit;
    if (i < tags.length - 1 && tags[i].y > tags[i + 1].y - 15) tags[i].y = tags[i + 1].y - 15;
  }
  for (const tag of tags) {
    ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    const tw = Math.ceil(ctx.measureText(tag.text).width) + 10;
    const x = price.x + price.w + 4;
    roundTag(ctx, x, tag.y - 8, tw, 16, 4);
    ctx.fillStyle = tag.color;
    ctx.fill();
    ctx.fillStyle = "#10161c";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(tag.text, x + 5, tag.y);
  }

  if (!pointer) return;
  const px = pointer.x;
  const py = pointer.y;
  const inPrice = px >= price.x && px <= price.x + price.w && py >= price.y && py <= price.y + price.h;
  const inX = px >= price.x && px <= price.x + price.w;
  if (!inX) return;
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = "rgba(180, 196, 214, 0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px, price.y);
  ctx.lineTo(px, showVolume ? vol.y + vol.h : price.y + price.h);
  if (inPrice) {
    ctx.moveTo(price.x, py);
    ctx.lineTo(price.x + price.w, py);
  }
  ctx.stroke();
  ctx.restore();

  if (inPrice) {
    const text = formatPx(m.pAt(py));
    ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    const tw = Math.ceil(ctx.measureText(text).width) + 10;
    const x = price.x + price.w + 4;
    roundTag(ctx, x, py - 8, tw, 16, 4);
    ctx.fillStyle = "#d5deea";
    ctx.fill();
    ctx.fillStyle = BG;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 5, py);
  }
}

export function zoomIndex(view: View, anchor: number, factor: number, n: number): View {
  let span = (view.i1 - view.i0) * factor;
  span = Math.max(8, Math.min(span, n + 8));
  const ratio = (anchor - view.i0) / (view.i1 - view.i0 || 1);
  const i0 = anchor - ratio * span;
  return { ...view, ...clampWindow(i0, i0 + span, n) };
}
