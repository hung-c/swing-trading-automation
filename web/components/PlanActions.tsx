"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { patternName } from "@/lib/format";
import type { WatchItem } from "@/lib/types";

export function PlanActions({ item, peers }: { item: WatchItem; peers: WatchItem[] }) {
  const router = useRouter();
  const activePeers = peers.filter((p) => p.id !== item.id && p.active && p.role === "saved");
  const [retire, setRetire] = useState(activePeers[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE", body: Record<string, string>) {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/watchlist", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(typeof j.error === "string" ? j.error : res.statusText);
      return;
    }
    router.refresh();
  }

  const retireId = retire || activePeers[0]?.id || "";

  return (
    <div className="plan-actions">
      {item.role === "candidate" ? (
        <>
          <button className="btn tiny" type="button" disabled={busy} onClick={() => send("POST", { action: "add", id: item.id })}>
            Add
          </button>
          {activePeers.length ? (
            <>
              {activePeers.length > 1 ? (
                <select value={retireId} onChange={(e) => setRetire(e.target.value)} aria-label="Plan to turn off">
                  {activePeers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {patternName(p.plan.pattern)}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                className="btn tiny ghost"
                type="button"
                disabled={busy || !retireId}
                onClick={() => send("POST", { action: "switch", id: item.id, retireId })}
              >
                Switch
              </button>
            </>
          ) : null}
        </>
      ) : item.active ? (
        <button className="btn tiny ghost" type="button" disabled={busy} onClick={() => send("POST", { action: "off", id: item.id })}>
          Turn off
        </button>
      ) : (
        <button className="btn tiny ghost" type="button" disabled={busy} onClick={() => send("POST", { action: "on", id: item.id })}>
          Turn on
        </button>
      )}
      <button className="btn tiny ghost" type="button" disabled={busy} onClick={() => send("DELETE", { id: item.id })}>
        Remove
      </button>
      {err ? <span className="notes">{err}</span> : null}
    </div>
  );
}
