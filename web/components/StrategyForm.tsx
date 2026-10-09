"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BlockSetup } from "@/components/BlockSetup";
import { StrategyCanvas } from "@/components/StrategyCanvas";
import {
  BLOCK_META,
  blockForReview,
  defaultFlow,
  isBlockId,
  linkId,
  type BlockId,
  type FlowClock,
} from "@/lib/strategy-flow";
import {
  BUILTIN_STRATEGY_ID,
  type Exchange,
  type PatternKey,
  type Strategy,
  type StrategySectionId,
} from "@/lib/strategy";
import type { StrategyReview } from "@/lib/strategy-review";
import type { FlowPayload } from "@/lib/flow";
import { deskNote, runDuration, runStamp, runSummary, statusLine, statusWord, strategyBlockRun } from "@/lib/strategy-status";

export function StrategyForm({ initial, id }: { initial: Strategy; id?: string }) {
  const builtin = id === BUILTIN_STRATEGY_ID;
  const router = useRouter();
  const [doc, setDoc] = useState<Strategy>(initial);
  const [flagsText, setFlagsText] = useState(initial.news.red_flags.join(", "));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [review, setReview] = useState<StrategyReview | null>(null);
  const [blockId, setBlockId] = useState<BlockId | null>(null);
  const [linkKey, setLinkKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [runs, setRuns] = useState<FlowPayload | null>(null);

  function payload(): Strategy {
    return {
      ...doc,
      news: {
        ...doc.news,
        red_flags: flagsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    };
  }

  function patch<S extends StrategySectionId>(section: S, partial: Partial<Strategy[S]>) {
    setDoc((prev) => ({ ...prev, [section]: { ...prev[section], ...partial } }));
  }

  function toggleExchange(ex: Exchange) {
    const cur = doc.universe.exchanges;
    const next = cur.includes(ex) ? cur.filter((x) => x !== ex) : [...cur, ex];
    patch("universe", { exchanges: next.length ? next : cur });
  }

  function togglePattern(key: PatternKey) {
    const cur = doc.technical.patterns;
    const next = cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key];
    patch("technical", { patterns: next });
  }

  function moveBlock(nodeId: BlockId, x: number, y: number) {
    setDoc((prev) => ({
      ...prev,
      flow: {
        ...prev.flow,
        nodes: prev.flow.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)),
      },
    }));
  }

  function connect(from: BlockId, to: BlockId) {
    if (from === to) return;
    setDoc((prev) => {
      if (prev.flow.links.some((l) => l.from === from && l.to === to)) return prev;
      return { ...prev, flow: { ...prev.flow, links: [...prev.flow.links, { from, to }] } };
    });
    setLinkKey(linkId({ from, to }));
    setBlockId(null);
  }

  function removeLink(key: string) {
    setDoc((prev) => ({
      ...prev,
      flow: { ...prev.flow, links: prev.flow.links.filter((l) => linkId(l) !== key) },
    }));
    setLinkKey(null);
  }

  function setClock(clock: FlowClock, enabled: boolean) {
    setDoc((prev) => ({
      ...prev,
      flow: { ...prev.flow, clocks: { ...prev.flow.clocks, [clock]: { enabled } } },
    }));
  }

  function resetLayout() {
    const fresh = defaultFlow();
    setDoc((prev) => ({ ...prev, flow: { ...prev.flow, nodes: fresh.nodes } }));
  }

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const res = await fetch("/api/flow", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as FlowPayload;
        if (!stop) setRuns(body);
      } catch {
        /* keep the last status */
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
    if (!linkKey || !editing) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      setDoc((prev) => ({
        ...prev,
        flow: { ...prev.flow, links: prev.flow.links.filter((l) => linkId(l) !== linkKey) },
      }));
      setLinkKey(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linkKey, editing]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch(id ? `/api/strategies/${id}` : "/api/strategies", {
      method: id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload()),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error ?? res.statusText);
      setBlockId("profile");
      return;
    }
    router.push("/strategies");
    router.refresh();
  }

  async function onEvaluate() {
    setEvaluating(true);
    setErr(null);
    const res = await fetch("/api/strategies/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload()),
    });
    const j = await res.json().catch(() => ({}));
    setEvaluating(false);
    if (!res.ok) {
      setErr(j.error ?? res.statusText);
      return;
    }
    const next = j as StrategyReview;
    setReview(next);
    const first = next.findings.map((f) => blockForReview(f.section)).find((b): b is BlockId => Boolean(b));
    if (first) {
      setBlockId(first);
      setLinkKey(null);
    }
  }

  async function onDelete() {
    if (!id) return;
    if (!window.confirm(`Delete “${doc.profile.name || "this strategy"}”?`)) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/strategies/${id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error ?? res.statusText);
      return;
    }
    router.push("/strategies");
    router.refresh();
  }

  const selected = blockId ? BLOCK_META[blockId] : null;
  const viewLine = editing
    ? "Drag the bottom dot onto another block to connect it. Click a block to set it up."
    : `${deskNote(id, runs)}${runs?.headline ?? "Loading the last run…"}`;

  return (
    <form className="flow-page" onSubmit={onSubmit}>
      <div className="flow-bar strategy-bar">
        <div>
          <h1>{doc.profile.name || "New strategy"}</h1>
          <p>{viewLine}</p>
        </div>
        <div className="actions">
          {id ? (
            <Link className="btn ghost" href={`/strategies/new?from=${id}`}>
              Duplicate
            </Link>
          ) : null}
          <Link className="btn ghost" href="/strategies">
            Back
          </Link>
          {editing ? (
            <>
              <button className="btn ghost" type="button" disabled={busy || evaluating} onClick={resetLayout}>
                Reset layout
              </button>
              {linkKey ? (
                <button className="btn ghost" type="button" onClick={() => removeLink(linkKey)}>
                  Remove connection
                </button>
              ) : null}
              <button className="btn ghost" type="button" disabled={busy || evaluating} onClick={onEvaluate}>
                {evaluating ? "Evaluating…" : "Evaluate"}
              </button>
              {id && !builtin ? (
                <button className="btn danger" type="button" disabled={busy || evaluating} onClick={onDelete}>
                  Delete
                </button>
              ) : null}
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  setEditing(false);
                  setLinkKey(null);
                }}
              >
                View
              </button>
              <button className="btn" type="submit" disabled={busy || evaluating}>
                {busy ? "Saving…" : id ? "Save" : "Save strategy"}
              </button>
            </>
          ) : (
            <button className="btn" type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
      </div>
      {err ? <p className="strategy-err">{err}</p> : null}
      {review ? (
        <div className="strategy-review">
          {review.findings.length ? (
            review.findings.map((f, i) => {
              const target = blockForReview(f.section);
              return (
                <button
                  key={`${f.section}-${i}`}
                  type="button"
                  className={`chip ${f.severity === "conflict" ? "bad" : f.severity === "gap" ? "warn" : ""}`}
                  onClick={() => {
                    if (!target || !isBlockId(target)) return;
                    setBlockId(target);
                    setLinkKey(null);
                  }}
                >
                  {f.section}: {f.message}
                </button>
              );
            })
          ) : (
            <span className="notes">No conflicts or gaps in this pass.</span>
          )}
        </div>
      ) : null}
      <StrategyCanvas
        doc={doc}
        selectedId={blockId}
        selectedLink={linkKey}
        onSelect={(nodeId) => {
          setBlockId(nodeId);
          setLinkKey(null);
        }}
        onSelectLink={(key) => {
          setLinkKey(key || null);
          if (key) setBlockId(null);
        }}
        onMove={moveBlock}
        onConnect={connect}
        panelOpen={Boolean(blockId)}
        editing={editing}
        runLine={(nodeId) => (nodeId === "profile" ? doc.profile.style : statusLine(strategyBlockRun(runs, nodeId)))}
        runStatus={(nodeId) => strategyBlockRun(runs, nodeId).status}
      />
      {selected && blockId ? (
        <aside className="flow-panel strategy-setup" onPointerDown={(e) => e.stopPropagation()}>
          <div className="flow-panel-top">
            <div>
              <div className="kicker">{selected.kicker}</div>
              <h2>{selected.title}</h2>
            </div>
            <button type="button" className="btn ghost" onClick={() => setBlockId(null)}>
              Close
            </button>
          </div>
          {editing ? (
            <BlockSetup
              block={blockId}
              doc={doc}
              flagsText={flagsText}
              review={review}
              onFlags={setFlagsText}
              onClock={setClock}
              patch={patch}
              toggleExchange={toggleExchange}
              togglePattern={togglePattern}
            />
          ) : (
            <RunPanel block={blockId} runs={runs} />
          )}
        </aside>
      ) : null}
    </form>
  );
}

function RunPanel({ block, runs }: { block: BlockId; runs: FlowPayload | null }) {
  const view = strategyBlockRun(runs, block);
  if (block === "profile") {
    return <p className="notes">The name and thesis. A run does not apply here. Edit to change them.</p>;
  }
  return (
    <>
      <span className={`chip ${view.status === "ok" || view.status === "skipped" ? "ok" : view.status === "failed" || view.status === "stalled" ? "bad" : view.status === "running" || view.status === "next" ? "warn" : ""}`}>
        {statusWord(view.status)}
      </span>
      {view.latest ? (
        <>
          <dl className="flow-facts">
            <div><dt>Started</dt><dd>{runStamp(view.latest.startedAt)} ET</dd></div>
            <div><dt>Finished</dt><dd>{view.latest.finishedAt ? `${runStamp(view.latest.finishedAt)} ET` : "Still running"}</dd></div>
            <div><dt>Duration</dt><dd>{runDuration(view.latest)}</dd></div>
          </dl>
          {runSummary(view.latest.summary) ? <p className="notes">{runSummary(view.latest.summary)}</p> : null}
          {view.latest.fallback ? <p className="notes">Taken from the last published brief.</p> : null}
          {view.latest.error ? <pre className="flow-error">{view.latest.error}</pre> : null}
        </>
      ) : (
        <p className="notes">No run recorded for this block yet.</p>
      )}
      {view.steps.length ? (
        <>
          <h3>Steps</h3>
          <ul className="run-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <span>{step.title}</span>
                <span className="flow-sub">{step.latest ? statusLine({ status: step.status, latest: step.latest, steps: [] }) : statusWord(step.status)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
