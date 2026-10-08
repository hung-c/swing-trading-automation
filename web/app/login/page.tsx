"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setErr("Wrong password");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h1>Swing desk</h1>
      <p className="lede">Password is the DASHBOARD_PASSWORD env var.</p>
      <label className="lede">
        Password
        <input name="password" type="password" autoFocus required style={{ width: "100%", marginTop: 6 }} />
      </label>
      {err ? <p className="notes" style={{ color: "var(--red)" }}>{err}</p> : null}
      <button className="btn" type="submit">
        Enter
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
