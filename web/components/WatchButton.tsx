"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function WatchButton({ symbol, saved }: { symbol: string; saved: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/watchlist", {
      method: saved ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol }),
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
      <button className={saved ? "btn ghost" : "btn"} type="button" disabled={busy} onClick={onClick}>
        {busy ? "Saving…" : saved ? "Remove from watchlist" : "Save to watchlist"}
      </button>
      {err ? <span className="notes">{err}</span> : null}
    </div>
  );
}
