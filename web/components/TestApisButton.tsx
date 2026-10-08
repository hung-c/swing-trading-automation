"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TestApisButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/apis/test", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { error?: string; ok?: number; fail?: number; skip?: number };
      if (!res.ok) {
        setErr(j.error ?? res.statusText);
        return;
      }
      setMsg(`${j.ok ?? 0} ok · ${j.fail ?? 0} failed · ${j.skip ?? 0} skipped`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", justifyItems: "end", gap: 6 }}>
      <button className="btn" type="button" onClick={onClick} disabled={busy}>
        {busy ? "Testing…" : "Test APIs"}
      </button>
      {msg ? <span className="notes">{msg}</span> : null}
      {err ? <span className="notes" style={{ color: "var(--red)" }}>{err}</span> : null}
    </div>
  );
}
