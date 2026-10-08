"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PositionForm() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    const res = await fetch("/api/positions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "open", ...body }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? res.statusText);
      return;
    }
    e.currentTarget.reset();
    router.refresh();
  }

  return (
    <form className="card form" onSubmit={onSubmit} style={{ marginTop: 16 }}>
      <label>
        Symbol
        <input name="symbol" required placeholder="XOM" />
      </label>
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
      <label>
        Resistance
        <input name="resistance" type="number" step="0.01" />
      </label>
      <label>
        Pattern
        <input name="pattern" placeholder="flat_base" />
      </label>
      {err ? <p className="notes" style={{ color: "var(--red)", gridColumn: "1 / -1" }}>{err}</p> : null}
      <div style={{ gridColumn: "1 / -1" }}>
        <button className="btn" disabled={busy} type="submit">
          {busy ? "Saving…" : "Record fill"}
        </button>
      </div>
    </form>
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
