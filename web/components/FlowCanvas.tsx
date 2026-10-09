"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { etTime } from "@/lib/format";
import { buildFlow, type BlockStatus, type FlowPayload, type FlowRun } from "@/lib/flow";

const MIN_Z = 0.35;
const MAX_Z = 2.2;

type View = { x: number; y: number; z: number };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function duration(run: FlowRun): string {
  if (!run.finishedAt) return "In progress";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function summaryText(summary: Record<string, unknown> | null): string {
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

function statusWord(status: BlockStatus): string {
  if (status === "ok") return "Ok";
  if (status === "running") return "Running";
  if (status === "stalled") return "Stalled";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  if (status === "next") return "Up next";
  return "No run yet";
}

function statusLine(status: BlockStatus, latest: FlowRun | null): string {
  if (status === "next") return "Up next";
  if (!latest) return "No run yet";
  if (latest.status === "running") return "Running";
  if (latest.status === "stalled") return "Stalled";
  if (latest.status === "failed") return "Failed";
  if (latest.status === "skipped") return "Skipped";
  const stamp = etTime(latest.finishedAt ?? latest.startedAt);
  return `Ok · ${stamp}`;
}

function edgePath(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  loop?: boolean,
): string {
  if (loop) {
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x + b.w;
    const y2 = b.y + b.h / 2;
    const x = Math.max(x1, x2) + 36;
    return `M ${x1} ${y1} C ${x} ${y1}, ${x} ${y2}, ${x2} ${y2}`;
  }
  const x1 = a.x + a.w / 2;
  const y1 = a.y + a.h;
  const x2 = b.x + b.w / 2;
  const y2 = b.y;
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

export function FlowCanvas() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<View>({ x: 24, y: 16, z: 1 });
  const [view, setView] = useState<View>({ x: 24, y: 16, z: 1 });
  const [data, setData] = useState<FlowPayload>(() => buildFlow([], [], new Date(), { configured: true, tableReady: true }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  viewRef.current = view;

  function fit() {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const world = data.world;
    const z = clamp(Math.min(1, (rect.width - 36) / world.w, (rect.height - 36) / world.h), MIN_Z, MAX_Z);
    const next = {
      z,
      x: (rect.width - world.w * z) / 2,
      y: Math.max(12, (rect.height - world.h * z) / 2),
    };
    viewRef.current = next;
    setView(next);
  }

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const res = await fetch("/api/flow", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as FlowPayload;
        if (!stop) {
          setData(body);
          setUpdatedAt(new Date());
        }
      } catch {
        /* keep the last chart */
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => fit());
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const current = viewRef.current;
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      const z = clamp(current.z * factor, MIN_Z, MAX_Z);
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const wx = (px - current.x) / current.z;
      const wy = (py - current.y) / current.z;
      const next = { z, x: px - wx * z, y: py - wy * z };
      viewRef.current = next;
      setView(next);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const drag = useRef<{ id: number; x: number; y: number; px: number; py: number; moved: boolean } | null>(null);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const current = viewRef.current;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, px: current.x, py: current.y, moved: false };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > 4) d.moved = true;
    if (!d.moved) return;
    const next = { ...viewRef.current, x: d.px + dx, y: d.py + dy };
    viewRef.current = next;
    setView(next);
  }

  function onPointerUp() {
    drag.current = null;
  }

  function selectNode(id: string) {
    setSelectedId((cur) => (cur === id ? null : id));
  }

  function zoomBy(factor: number) {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const current = viewRef.current;
    const z = clamp(current.z * factor, MIN_Z, MAX_Z);
    const px = rect.width / 2;
    const py = rect.height / 2;
    const wx = (px - current.x) / current.z;
    const wy = (py - current.y) / current.z;
    const next = { z, x: px - wx * z, y: py - wy * z };
    viewRef.current = next;
    setView(next);
  }

  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  return (
    <div className="flow-page">
      <div className="flow-bar">
        <div>
          <h1>Pipeline</h1>
          <p>{data.headline}</p>
        </div>
        <div className="flow-legend">
          <span className="lg running">Running</span>
          <span className="lg next">Up next</span>
          <span className="lg ok">Ok</span>
          <span className="lg failed">Failed</span>
          <span className="lg skipped">Skipped</span>
          {updatedAt ? <span className="lg mute">{etTime(updatedAt.toISOString())}</span> : null}
        </div>
      </div>
      <div
        className="flow-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          className="flow-world"
          style={{
            width: data.world.w,
            height: data.world.h,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
          }}
        >
          <svg className="flow-edges" width={data.world.w} height={data.world.h}>
            <defs>
              <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#5d6d82" />
              </marker>
            </defs>
            {data.edges.map((edge) => {
              const a = byId.get(edge.from);
              const b = byId.get(edge.to);
              if (!a || !b) return null;
              return (
                <path
                  key={`${edge.from}-${edge.to}-${edge.loop ? "loop" : "line"}`}
                  d={edgePath(a, b, edge.loop)}
                  className={edge.loop ? "loop" : ""}
                  markerEnd="url(#flow-arrow)"
                />
              );
            })}
          </svg>
          {data.nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              data-node={node.id}
              className={`flow-node${node.step ? "" : " head"} status-${node.status}${selectedId === node.id ? " on" : ""}`}
              style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => selectNode(node.id)}
            >
              {node.hint ? <span className="flow-when">{node.hint}</span> : null}
              <span className="flow-title">{node.title}</span>
              <span className="flow-sub">{statusLine(node.status, node.latest)}</span>
            </button>
          ))}
        </div>
        <div className="flow-tools" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="btn ghost" onClick={() => zoomBy(1.15)}>
            Zoom in
          </button>
          <button type="button" className="btn ghost" onClick={() => zoomBy(1 / 1.15)}>
            Zoom out
          </button>
          <button type="button" className="btn ghost" onClick={fit}>
            Fit
          </button>
          <span className="flow-zoom">{Math.round(view.z * 100)}%</span>
        </div>
      </div>
      {selected ? (
        <aside className="flow-panel" onPointerDown={(e) => e.stopPropagation()}>
          <div className="flow-panel-top">
            <div>
              <div className="kicker">{selected.step ? selected.hint || JOB_HINT[selected.job] : "Workflow"}</div>
              <h2>{selected.title}</h2>
              <span className={`chip ${chipClass(selected.status)}`}>{statusWord(selected.status)}</span>
            </div>
            <button type="button" className="btn ghost" onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>
          {selected.latest ? <RunDetail run={selected.latest} /> : <p className="notes">No run recorded for this block yet.</p>}
          {selected.history.length ? (
            <>
              <h3>Earlier runs</h3>
              <ul className="flow-history">
                {selected.history.map((run) => (
                  <li key={run.id}>
                    <RunDetail run={run} compact />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

const JOB_HINT: Record<string, string> = {
  premarket: "Premarket",
  intraday: "Intraday",
  nightly: "Nightly",
  report: "Weekly report",
};

function chipClass(status: BlockStatus): string {
  if (status === "ok") return "ok";
  if (status === "failed" || status === "stalled") return "bad";
  if (status === "running" || status === "next") return "warn";
  return "";
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function RunDetail({ run, compact = false }: { run: FlowRun; compact?: boolean }) {
  const line = summaryText(run.summary);
  return (
    <div className={compact ? "flow-detail compact" : "flow-detail"}>
      <dl className="flow-facts">
        <div><dt>Status</dt><dd>{statusWord(run.status)}</dd></div>
        <div><dt>Started</dt><dd>{when(run.startedAt)} ET</dd></div>
        <div><dt>Finished</dt><dd>{run.finishedAt ? `${when(run.finishedAt)} ET` : "Still running"}</dd></div>
        <div><dt>Duration</dt><dd>{duration(run)}</dd></div>
      </dl>
      {line ? <p className="notes">{line}</p> : null}
      {run.fallback ? <p className="notes">Taken from the last published brief.</p> : null}
      {run.error ? <pre className="flow-error">{run.error}</pre> : null}
    </div>
  );
}
