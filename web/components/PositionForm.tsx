"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { patternName, usd } from "@/lib/format";
import type { WatchItem } from "@/lib/types";

function savedPlans(plans: WatchItem[]): WatchItem[] {
  return plans.filter((p) => p.active && p.role === "saved");
}

export function PositionForm({ plans }: { plans: WatchItem[] }) {
  const router = useRouter();
  const saved = savedPlans(plans);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planId, setPlanId] = useState(saved.length === 1 ? saved[0].id : "");
  const chosen = saved.find((p) => p.id === planId) ?? null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!chosen) {
      setErr("Choose a saved plan");
      return;
    }
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/positions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "open",
        planId: chosen.id,
        opened: fd.get("opened"),
        entry: fd.get("entry"),
        stop: fd.get("stop"),
        shares: fd.get("shares"),
        target_2r: fd.get("target_2r"),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(typeof j.error === "string" ? j.error : res.statusText);
      return;
    }
    e.currentTarget.reset();
    setPlanId(saved.length === 1 ? saved[0].id : "");
    router.refresh();
  }

  if (!saved.length) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <p className="notes" style={{ margin: 0 }}>
          Save a plan before logging a fill. Pattern and resistance come from that plan.{" "}
          <Link href="/plans" style={{ textDecoration: "underline" }}>
            Open plans
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form className="card form" onSubmit={onSubmit} style={{ marginTop: 16 }}>
      <label style={{ gridColumn: "1 / -1" }}>
        Plan
        <select name="planId" required value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {saved.length > 1 ? <option value="">Choose a plan</option> : null}
          {saved.map((p) => (
            <option key={p.id} value={p.id}>
              {p.symbol} · {patternName(p.plan.pattern)} · entry {usd(p.plan.entry)}
            </option>
          ))}
        </select>
      </label>
      {chosen ? (
        <p className="notes" style={{ gridColumn: "1 / -1", margin: 0 }}>
          {patternName(chosen.plan.pattern)} · resistance {usd(chosen.plan.resistance)}
        </p>
      ) : (
        <p className="notes" style={{ gridColumn: "1 / -1", margin: 0 }}>
          Pattern and resistance come from the plan you pick.
        </p>
      )}
      <label>
        Opened
        <input name="opened" type="date" required />
      </label>
      <label>
        Entry
        <input name="entry" type="number" step="0.01" required />
      </label>
      <label>
        Stop
        <input name="stop" type="number" step="0.01" required />
      </label>
      <label>
        Shares
        <input name="shares" type="number" step="0.01" required />
      </label>
      <label>
        2R target
        <input name="target_2r" type="number" step="0.01" required />
      </label>
      {err ? <p className="notes" style={{ color: "var(--red)", gridColumn: "1 / -1" }}>{err}</p> : null}
      <div style={{ gridColumn: "1 / -1" }}>
        <button className="btn" disabled={busy || !chosen} type="submit">
          {busy ? "Saving…" : "Record fill"}
        </button>
      </div>
    </form>
  );
}

export function PositionPlanSwitch({ symbol, planId, plans }: { symbol: string; planId: string | null; plans: WatchItem[] }) {
  const router = useRouter();
  const choices = plans.filter((p) => p.symbol === symbol && p.id !== planId);
  const [pick, setPick] = useState(choices[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!choices.length) return null;

  async function onClick() {
    const id = pick || choices[0]?.id;
    if (!id) return;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/positions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "switch_plan", symbol, planId: id }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(typeof j.error === "string" ? j.error : res.statusText);
      return;
    }
    router.refresh();
  }

  return (
    <div className="plan-actions">
      {choices.length > 1 ? (
        <select value={pick || choices[0].id} onChange={(e) => setPick(e.target.value)} aria-label="Plan to follow">
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {patternName(p.plan.pattern)}
              {p.role === "candidate" ? " · new" : ""}
            </option>
          ))}
        </select>
      ) : (
        <span className="notes">
          {patternName(choices[0].plan.pattern)}
          {choices[0].role === "candidate" ? " · new plan" : ""}
        </span>
      )}
      <button className="btn tiny ghost" type="button" disabled={busy} onClick={onClick}>
        Switch plan
      </button>
      {err ? <span className="notes">{err}</span> : null}
    </div>
  );
}

export function CloseButton({ symbol }: { symbol: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    const exit = window.prompt(`Exit price for ${symbol}?`);
    if (!exit) return;
    setBusy(true);
    await fetch("/api/positions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "close", symbol, exit_price: Number(exit) }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <button className="btn ghost" disabled={busy} onClick={onClick} type="button">
      Close
    </button>
  );
}
