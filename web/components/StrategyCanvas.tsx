"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  BLOCK_META,
  NODE_H,
  NODE_W,
  clockOf,
  clockWhen,
  isBlockId,
  linkId,
  type BlockId,
  type StrategyFlow,
} from "@/lib/strategy-flow";
import type { Strategy } from "@/lib/strategy";
import type { BlockStatus } from "@/lib/flow";

const MIN_Z = 0.28;
const MAX_Z = 2.2;

type View = { x: number; y: number; z: number };
type Wire = { from: BlockId; x: number; y: number };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const x1 = a.x + NODE_W / 2;
  const y1 = a.y + NODE_H;
  const x2 = b.x + NODE_W / 2;
  const y2 = b.y;
  const dy = Math.max(28, Math.abs(y2 - y1) * 0.45);
  const bend = Math.abs(x2 - x1) < 24 ? 0 : Math.sign(x2 - x1) * 16;
  return `M ${x1} ${y1} C ${x1 + bend} ${y1 + dy}, ${x2 - bend} ${y2 - dy}, ${x2} ${y2}`;
}

function blockOn(doc: Strategy, id: BlockId): boolean {
  const clock = clockOf(id);
  if (clock) return doc.flow.clocks[clock].enabled;
  if (id === "scanner") return doc.scanner.enabled;
  if (id === "technical") return doc.technical.enabled;
  if (id === "regime") return doc.regime.enabled;
  if (id === "news") return doc.news.enabled;
  if (id === "alerts") return doc.alerts.enabled;
  if (id === "evaluator") {
    const g = doc.evaluator.gates;
    return g.plan_card || g.actionable_alert || g.management;
  }
  return true;
}

function blockDetail(doc: Strategy, id: BlockId): string {
  const meta = BLOCK_META[id];
  const clock = clockOf(id);
  if (clock) return doc.flow.clocks[clock].enabled ? clockWhen(clock, doc.flow.clocks[clock]) : "Off";
  if (id === "profile") return doc.profile.style;
  if (!blockOn(doc, id) && id !== "universe" && id !== "risk" && id !== "management") return "Off";
  return meta.when;
}

export function StrategyCanvas({
  doc,
  selectedId,
  selectedLink,
  onSelect,
  onSelectLink,
  onMove,
  onConnect,
  panelOpen = false,
  editing = false,
  runLine,
  runStatus,
}: {
  doc: Strategy;
  selectedId: BlockId | null;
  selectedLink: string | null;
  onSelect: (id: BlockId) => void;
  onSelectLink: (id: string) => void;
  onMove: (id: BlockId, x: number, y: number) => void;
  onConnect: (from: BlockId, to: BlockId) => void;
  panelOpen?: boolean;
  editing?: boolean;
  runLine?: (id: BlockId) => string;
  runStatus?: (id: BlockId) => BlockStatus;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<View>({ x: 24, y: 16, z: 0.85 });
  const [view, setView] = useState<View>(viewRef.current);
  const [wire, setWire] = useState<Wire | null>(null);
  const flow: StrategyFlow = doc.flow;
  viewRef.current = view;

  const byId = useMemo(() => new Map(flow.nodes.map((n) => [n.id, n])), [flow.nodes]);
  const worldRef = useRef({ w: 960, h: 720 });

  const world = useMemo(() => {
    let maxX = 720;
    let maxY = 420;
    for (const n of flow.nodes) {
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + NODE_H);
    }
    if (wire) {
      maxX = Math.max(maxX, wire.x);
      maxY = Math.max(maxY, wire.y);
    }
    return { w: maxX + 64, h: maxY + 64 };
  }, [flow.nodes, wire]);
  worldRef.current = world;

  function toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const stage = stageRef.current;
    const current = viewRef.current;
    if (!stage) return { x: 0, y: 0 };
    const rect = stage.getBoundingClientRect();
    return {
      x: (clientX - rect.left - current.x) / current.z,
      y: (clientY - rect.top - current.y) / current.z,
    };
  }

  function fit() {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const box = worldRef.current;
    if (rect.width < 40 || rect.height < 40) return;
    const z = clamp(Math.min(1, (rect.width - 36) / box.w, (rect.height - 36) / box.h), MIN_Z, MAX_Z);
    const next = {
      z,
      x: Math.max(12, (rect.width - box.w * z) / 2),
      y: Math.max(12, (rect.height - box.h * z) / 2),
    };
    viewRef.current = next;
    setView(next);
  }

  useEffect(() => {
    const id = window.requestAnimationFrame(() => fit());
    return () => window.cancelAnimationFrame(id);
  }, [panelOpen]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if ((e.target as HTMLElement | null)?.closest(".strategy-setup, .flow-tools, .flow-bar")) return;
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

  const pan = useRef<{ id: number; x: number; y: number; px: number; py: number } | null>(null);

  function onStageDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-node], .flow-tools, .sedge")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const current = viewRef.current;
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, px: current.x, py: current.y };
    onSelectLink("");
  }

  function onStageMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = pan.current;
    if (!d || d.id !== e.pointerId) return;
    const next = { ...viewRef.current, x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) };
    viewRef.current = next;
    setView(next);
  }

  function onStageUp() {
    pan.current = null;
  }

  function startDrag(e: ReactPointerEvent<HTMLDivElement>, id: BlockId) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".port")) return;
    e.stopPropagation();
    const node = byId.get(id);
    if (!node) return;
    const origin = toWorld(e.clientX, e.clientY);
    const start = { x: node.x, y: node.y, ox: origin.x, oy: origin.y, moved: false };
    function move(ev: PointerEvent) {
      const p = toWorld(ev.clientX, ev.clientY);
      const dx = p.x - start.ox;
      const dy = p.y - start.oy;
      if (Math.hypot(dx, dy) > 4) start.moved = true;
      if (!start.moved) return;
      const x = clamp(Math.round((start.x + dx) / 8) * 8, 0, 4000);
      const y = clamp(Math.round((start.y + dy) / 8) * 8, 0, 4000);
      onMove(id, x, y);
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!start.moved) onSelect(id);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startWire(e: ReactPointerEvent<HTMLButtonElement>, id: BlockId) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    setWire({ from: id, x: p.x, y: p.y });
    function move(ev: PointerEvent) {
      const next = toWorld(ev.clientX, ev.clientY);
      setWire({ from: id, x: next.x, y: next.y });
    }
    function up(ev: PointerEvent) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWire(null);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const nodeEl = el?.closest("[data-node]");
      const to = nodeEl?.getAttribute("data-node") ?? "";
      if (isBlockId(to)) onConnect(id, to);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const wireFrom = wire ? byId.get(wire.from) : null;

  return (
    <div
      className={`flow-stage${wire ? " wiring" : ""}`}
      ref={stageRef}
      onPointerDown={onStageDown}
      onPointerMove={onStageMove}
      onPointerUp={onStageUp}
    >
      <div
        className="flow-world"
        style={{
          width: world.w,
          height: world.h,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
        }}
      >
        <svg className="flow-edges" width={world.w} height={world.h}>
          <defs>
            <marker id="strategy-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#5d6d82" />
            </marker>
          </defs>
          {flow.links.map((link) => {
            const a = byId.get(link.from);
            const b = byId.get(link.to);
            if (!a || !b) return null;
            const id = linkId(link);
            const d = edgePath(a, b);
            return (
              <g key={id}>
                <path d={d} className="sedge-line" markerEnd="url(#strategy-arrow)" />
                <path
                  d={d}
                  className={`sedge${selectedLink === id ? " on" : ""}`}
                  onPointerDown={(e) => {
                    if (!editing) return;
                    e.stopPropagation();
                    onSelectLink(id);
                  }}
                />
              </g>
            );
          })}
          {wire && wireFrom ? (
            <path className="sedge-line live" d={edgePath(wireFrom, { x: wire.x - NODE_W / 2, y: wire.y })} />
          ) : null}
        </svg>
        {flow.nodes.map((node) => {
          const meta = BLOCK_META[node.id];
          const on = blockOn(doc, node.id);
          const clock = clockOf(node.id);
          const live = !editing && node.id !== "profile" ? runStatus?.(node.id) : null;
          return (
            <div
              key={node.id}
              data-node={node.id}
              role="button"
              tabIndex={0}
              className={`sblock${clock || node.id === "profile" ? " clock" : ""}${on ? "" : " off"}${selectedId === node.id ? " on" : ""}${live ? ` status-${live}` : ""}`}
              style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
              onPointerDown={(e) => {
                if (!editing) {
                  e.stopPropagation();
                  onSelect(node.id);
                  return;
                }
                startDrag(e, node.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(node.id);
              }}
            >
              <span className="flow-when">{meta.kicker}</span>
              <span className="flow-title">{meta.title}</span>
              <span className="flow-sub">{editing ? blockDetail(doc, node.id) : (runLine?.(node.id) ?? blockDetail(doc, node.id))}</span>
              {editing ? (
                <>
                  <button type="button" className="port in" aria-label={`Connect into ${meta.title}`} tabIndex={-1} />
                  <button
                    type="button"
                    className="port out"
                    aria-label={`Connect from ${meta.title}`}
                    onPointerDown={(e) => startWire(e, node.id)}
                  />
                </>
              ) : null}
            </div>
          );
        })}
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
  );
}
