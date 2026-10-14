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

  const label = err ?? (saved ? "Remove from watchlist" : "Save to watchlist");
  return (
    <button
      className={saved ? "plan-watch on" : "plan-watch"}
      type="button"
      disabled={busy}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {saved ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
