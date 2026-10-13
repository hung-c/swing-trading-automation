"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_PERIODS,
  INDICATORS,
  LEVELS,
  type Bar,
  type ChartLevels,
  type Frame,
  clampWindow,
  computeLine,
  defaultOn,
  formatBarTime,
  formatPx,
  formatVol,
  indicatorName,
  inferPattern,
  patternKindFor,
  shapeLabel,
} from "@/lib/chart-math";
import { hitTest, measure, paint, zoomIndex, type DrawInput, type View } from "@/lib/chart-draw";

const FRAMES: { id: Frame; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "intraday", label: "15 min" },
];

type Hover = { x: number; y: number; i: number; hotId: string | null; hotName: string | null; hotValue: string | null };

type Drag =
  | { kind: "pan"; x: number; i0: number; i1: number; y0: number; y1: number; yAuto: boolean; plotW: number }
  | { kind: "yscale"; y: number; i0: number; i1: number; y0: number; y1: number }
  | { kind: "xscale"; x: number; i0: number; i1: number; y0: number; y1: number; yAuto: boolean };

function valueAt(values: (number | null)[], i: number): number | null {
  if (values[i] != null) return values[i];
  if (i > 0 && values[i - 1] != null) return values[i - 1];
  if (i + 1 < values.length && values[i + 1] != null) return values[i + 1];
  return null;
}

export function PlanChart({ symbol, pattern, levels }: { symbol: string; pattern: string; levels: ChartLevels }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<DrawInput | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const cacheRef = useRef<{ symbol: string; frames: Partial<Record<Frame, Bar[]>> }>({ symbol: "", frames: {} });
  const [frame, setFrame] = useState<Frame>("daily");
  const [bars, setBars] = useState<Bar[]>([]);
  const [daily, setDaily] = useState<Bar[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const apply = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setStatus("loading");
    setError("");
    setBars([]);
    setView(null);
    setHover(null);
    if (cacheRef.current.symbol !== symbol) {
      cacheRef.current = { symbol, frames: {} };
      setDaily([]);
    }
    const bag = cacheRef.current;

    const load = (f: Frame) => {
      const hit = bag.frames[f];
      if (hit) return Promise.resolve(hit);
      return fetch(`/api/bars/${encodeURIComponent(symbol)}?frame=${f}`, { signal: ac.signal })
        .then(async (r) => {
          const data = (await r.json()) as { bars?: Bar[]; error?: string };
          if (!r.ok) throw new Error(data.error || "Could not load bars");
          return data.bars ?? [];
        })
        .then((next) => {
          bag.frames[f] = next;
          return next;
        });
    };

    const needed: Frame[] = frame === "daily" ? ["daily"] : [frame, "daily"];
    Promise.all(needed.map((f) => load(f)))
      .then((loaded) => {
        if (ac.signal.aborted) return;
        const byFrame = Object.fromEntries(needed.map((f, i) => [f, loaded[i]])) as Partial<Record<Frame, Bar[]>>;
        const next = byFrame[frame] ?? [];
        setBars(next);
        setDaily(byFrame.daily ?? bag.frames.daily ?? []);
        setStatus(next.length ? "ready" : "error");
        if (!next.length) setError("No price bars for this symbol.");
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setStatus("error");
        setError(e instanceof Error ? e.message : "Could not load bars");
      });
    return () => ac.abort();
  }, [symbol, frame]);

  const lines = useMemo(
    () =>
      INDICATORS.filter((ind) => defaultOn(ind.id, frame)).map((ind) => ({
        id: ind.id,
        name: indicatorName(ind.id, DEFAULT_PERIODS[ind.id]),
        color: ind.color,
        values: computeLine(bars, ind.id, DEFAULT_PERIODS[ind.id] || 2),
      })),
    [bars, frame],
  );

  const marks = useMemo(
    () => LEVELS.filter((level) => defaultOn(level.id, frame) && levels[level.id] > 0).map((level) => ({ ...level, price: levels[level.id] })),
    [frame, levels],
  );

  const drawn = useMemo(() => {
    const source = daily.length >= 5 ? daily : frame === "daily" ? bars : [];
    if (!source.length || !defaultOn("pattern", frame)) return null;
    const kind = patternKindFor(pattern);
    const anchors = inferPattern(source, kind, levels.resistance, levels.stop);
    if (!anchors.length) return null;
    return { kind, label: shapeLabel(kind, pattern), anchors };
  }, [daily, bars, frame, pattern, levels.resistance, levels.stop]);

  const model = useMemo<DrawInput>(
    () => ({
      bars,
      frame,
      view,
      width: size.w,
      height: size.h,
      lines,
      levels: marks,
      pattern: drawn,
      showVolume: defaultOn("volume", frame),
      hotId: hover?.hotId ?? null,
      pointer: hover ? { x: hover.x, y: hover.y } : null,
    }),
    [bars, frame, view, size, lines, marks, drawn, hover],
  );
  modelRef.current = model;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 10) return;
    paint(canvas, model);
  }, [model, size.w]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const applyHover = (x: number, y: number) => {
      const current = modelRef.current;
      if (!current?.bars.length) return;
      const hit = hitTest(current, x, y);
      if (!hit || hit.type === "price-scale" || hit.type === "time-scale") {
        setHover(null);
        canvas.style.cursor = dragRef.current
          ? "grabbing"
          : hit
            ? hit.type === "price-scale"
              ? "ns-resize"
              : "ew-resize"
            : "crosshair";
        return;
      }
      const i = hit.i;
      const bar = current.bars[i];
      let hotId: string | null = null;
      let hotName: string | null = null;
      let hotValue: string | null = null;
      if (hit.type === "line") {
        const line = current.lines.find((item) => item.id === hit.id);
        const v = line ? valueAt(line.values, i) : null;
        hotId = hit.id;
        hotName = line?.name ?? hit.id;
        hotValue = v == null ? "—" : formatPx(v);
      } else if (hit.type === "level") {
        const level = current.levels.find((item) => item.id === hit.id);
        hotId = hit.id;
        hotName = level?.name ?? hit.id;
        hotValue = level ? formatPx(level.price) : null;
      } else if (hit.type === "pattern" && current.pattern) {
        hotId = "pattern";
        hotName = current.pattern.label;
        hotValue = bar ? formatBarTime(bar.t, current.frame) : null;
      }
      setHover({ x, y, i, hotId, hotName, hotValue });
      canvas.style.cursor = dragRef.current ? "grabbing" : "crosshair";
    };

    const onWheel = (e: WheelEvent) => {
      const current = modelRef.current;
      const m = current && measure(current);
      if (!current || !m) return;
      e.preventDefault();
      const { x, y } = local(e);
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      const onScale = x >= m.price.x + m.price.w || e.shiftKey;
      if (onScale) {
        const p = m.pAt(Math.min(Math.max(y, m.price.y), m.price.y + m.price.h));
        const y0 = p - (p - m.view.y0) * factor;
        const y1 = p + (m.view.y1 - p) * factor;
        const span = y1 - y0;
        if (span < Math.abs(p) * 0.002 || span > Math.max(Math.abs(p), 1) * 6) return;
        setView({ ...m.view, y0, y1, yAuto: false });
        return;
      }
      setView(zoomIndex(m.view, m.iAt(x), factor, current.bars.length));
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const current = modelRef.current;
      const m = current && measure(current);
      if (!current || !m) return;
      const { x, y } = local(e);
      const hit = hitTest(current, x, y);
      if (!hit) return;
      if (hit.type === "price-scale") {
        dragRef.current = { kind: "yscale", y: e.clientY, i0: m.view.i0, i1: m.view.i1, y0: m.view.y0, y1: m.view.y1 };
      } else if (hit.type === "time-scale") {
        dragRef.current = { kind: "xscale", x: e.clientX, i0: m.view.i0, i1: m.view.i1, y0: m.view.y0, y1: m.view.y1, yAuto: m.view.yAuto };
      } else {
        dragRef.current = {
          kind: "pan",
          x: e.clientX,
          i0: m.view.i0,
          i1: m.view.i1,
          y0: m.view.y0,
          y1: m.view.y1,
          yAuto: m.view.yAuto,
          plotW: m.price.w,
        };
      }
      canvas.style.cursor = "grabbing";
      canvas.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      const current = modelRef.current;
      const { x, y } = local(e);
      const drag = dragRef.current;
      if (current && drag?.kind === "pan") {
        const di = ((e.clientX - drag.x) / Math.max(drag.plotW, 1)) * (drag.i1 - drag.i0);
        const next = clampWindow(drag.i0 - di, drag.i1 - di, current.bars.length);
        setView({ ...next, y0: drag.y0, y1: drag.y1, yAuto: drag.yAuto });
      } else if (drag?.kind === "yscale") {
        const scale = Math.exp((e.clientY - drag.y) * 0.008);
        const mid = (drag.y0 + drag.y1) / 2;
        const half = Math.max(Math.abs(mid) * 0.002, ((drag.y1 - drag.y0) / 2) * scale);
        setView({ i0: drag.i0, i1: drag.i1, y0: mid - half, y1: mid + half, yAuto: false });
      } else if (current && drag?.kind === "xscale") {
        const scale = Math.exp((drag.x - e.clientX) * 0.008);
        const mid = (drag.i0 + drag.i1) / 2;
        let span = (drag.i1 - drag.i0) * scale;
        span = Math.max(8, Math.min(span, current.bars.length + 8));
        const next = clampWindow(mid - span / 2, mid + span / 2, current.bars.length);
        setView({ ...next, y0: drag.y0, y1: drag.y1, yAuto: drag.yAuto });
      }
      applyHover(x, y);
    };

    const endDrag = () => {
      dragRef.current = null;
      canvas.style.cursor = "crosshair";
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    const onLeave = () => {
      if (!dragRef.current) setHover(null);
    };
    const onDbl = () => setView(null);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("dblclick", onDbl);
    window.addEventListener("pointerup", endDrag);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDbl);
      window.removeEventListener("pointerup", endDrag);
    };
  }, []);

  const zoomBy = (factor: number) => {
    const current = modelRef.current;
    const m = current && measure(current);
    if (!current || !m) return;
    const mid = (m.view.i0 + m.view.i1) / 2;
    setView(zoomIndex(m.view, mid, factor, current.bars.length));
  };

  const bar = bars[hover?.i ?? bars.length - 1];
  const tip =
    hover?.hotName && hover.hotId
      ? {
          name: hover.hotName,
          when: bar ? formatBarTime(bar.t, frame) : "",
          value: hover.hotId === "pattern" ? null : hover.hotValue,
          left: hover.x > size.w - 188 ? hover.x - 164 : hover.x + 14,
          top: hover.y > size.h - 88 ? hover.y - 72 : hover.y + 14,
        }
      : null;

  return (
    <section className="card ichart">
      <div className="ichart-toolbar">
        <div className="ichart-frames">
          {FRAMES.map((item) => (
            <button key={item.id} type="button" className={item.id === frame ? "btn" : "btn ghost"} onClick={() => setFrame(item.id)}>
              {item.label}
            </button>
          ))}
          <span className="pat">{shapeLabel(patternKindFor(pattern), pattern)}</span>
        </div>
        <div className="ichart-frames">
          <button type="button" className="btn ghost" onClick={() => zoomBy(1 / 1.12)} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="btn ghost" onClick={() => zoomBy(1.12)} aria-label="Zoom out">
            −
          </button>
          <button type="button" className="btn ghost" onClick={() => setView(null)}>
            Reset view
          </button>
        </div>
      </div>
      <p className="ichart-hint">The pattern is measured on the daily bars and drawn on the same dates here. Scroll to zoom, drag to pan.</p>
      <div className="ichart-readout" aria-live="polite">
        {bar ? (
          <>
            <span className="ichart-date">{formatBarTime(bar.t, frame)}</span>
            <span>O <b>{formatPx(bar.o)}</b></span>
            <span>H <b>{formatPx(bar.h)}</b></span>
            <span>L <b>{formatPx(bar.l)}</b></span>
            <span className={bar.c >= bar.o ? "pos" : "neg"}>C <b>{formatPx(bar.c)}</b></span>
            <span>Vol <b>{formatVol(bar.v)}</b></span>
            {lines.map((line) => {
              const v = valueAt(line.values, hover?.i ?? bars.length - 1);
              return (
                <span key={line.id} className={hover?.hotId === line.id ? "hot" : ""} style={{ color: line.color }}>
                  {line.name} <b>{v == null ? "—" : formatPx(v)}</b>
                </span>
              );
            })}
            {marks.map((level) => (
              <span key={level.id} className={hover?.hotId === level.id ? "hot" : ""} style={{ color: level.color }}>
                {level.name} <b>{formatPx(level.price)}</b>
              </span>
            ))}
          </>
        ) : (
          <span className="ichart-date">{status === "loading" ? "Loading bars…" : "No bars"}</span>
        )}
      </div>
      <div className="ichart-stage" ref={stageRef}>
        <canvas ref={canvasRef} aria-label={`${symbol} ${frame} chart`} />
        {status === "loading" ? <div className="ichart-msg">Loading bars…</div> : null}
        {status === "error" ? <div className="ichart-msg">{error}</div> : null}
        {tip ? (
          <div className="ichart-tip" style={{ left: tip.left, top: tip.top }}>
            <strong>{tip.name}</strong>
            <span>{tip.when}</span>
            {tip.value ? <b>{tip.value}</b> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
