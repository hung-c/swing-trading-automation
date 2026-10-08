import { NextResponse } from "next/server";
import { todayEt, type ApiTest, type ApiUsage } from "@/lib/apis";
import { asObj, getSql } from "@/lib/db";
import { pipelineEnv } from "@/lib/pipeline-env";
import { avSpent, probeApis } from "@/lib/probe-apis";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST() {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL missing" }, { status: 500 });

  const found = await sql`SELECT k, v FROM kv WHERE k IN ('api_usage', 'av_budget')`;
  let usage: ApiUsage | null = null;
  let av: { date: string; used: number } | null = null;
  for (const row of (Array.isArray(found) ? found : []) as { k: string; v: unknown }[]) {
    if (row.k === "api_usage") {
      const v = asObj<ApiUsage>(row.v);
      usage = { date: String(v.date ?? ""), calls: v.calls ?? {}, jobs: v.jobs ?? {}, secrets: v.secrets ?? {}, updatedAt: null };
    } else if (row.k === "av_budget") {
      const v = asObj<{ date?: string; used?: number }>(row.v);
      av = { date: String(v.date ?? ""), used: Number(v.used ?? 0) };
    }
  }

  const spentBefore = avSpent(av);
  const results = await probeApis(spentBefore);
  const called = results.filter((r) => r.state !== "skip").map((r) => r.id);
  const avCalled = results.some((r) => r.id === "alphavantage" && r.state !== "skip");

  const today = todayEt();
  const sameDay = usage?.date === today;
  const calls = { ...(sameDay ? usage?.calls : {}) };
  const jobs = { ...(sameDay ? usage?.jobs : {}) };
  const bucket = {
    runs: Number(jobs.test?.runs ?? 0) + 1,
    calls: { ...(jobs.test?.calls ?? {}) },
  };
  for (const id of called) {
    calls[id] = Number(calls[id] ?? 0) + 1;
    bucket.calls[id] = Number(bucket.calls[id] ?? 0) + 1;
  }
  jobs.test = bucket;
  const secrets = { ...(usage?.secrets ?? {}) };
  const present: Record<string, boolean> = {
    alpaca: Boolean(pipelineEnv("ALPACA_KEY") && pipelineEnv("ALPACA_SECRET")),
    massive: Boolean(pipelineEnv("MASSIVE_KEY")),
    finnhub: Boolean(pipelineEnv("FINNHUB_KEY")),
    alphavantage: Boolean(pipelineEnv("ALPHAVANTAGE_KEY")),
    sec: Boolean(pipelineEnv("SEC_USER_AGENT")),
    fred: Boolean(pipelineEnv("FRED_KEY")),
    groq: Boolean(pipelineEnv("GROQ_KEY")),
    gemini: Boolean(pipelineEnv("GEMINI_KEY")),
    telegram: Boolean(pipelineEnv("TELEGRAM_BOT_TOKEN") && pipelineEnv("TELEGRAM_CHAT_ID")),
  };
  for (const [id, on] of Object.entries(present)) {
    if (on) secrets[id] = true;
  }
  const nextUsage = {
    date: today,
    calls,
    jobs,
    secrets,
  };

  const test: ApiTest = { at: new Date().toISOString(), results };
  await sql`
    INSERT INTO kv (k, v, updated_at) VALUES ('api_test', ${JSON.stringify(test)}::jsonb, now())
    ON CONFLICT (k) DO UPDATE SET v = excluded.v, updated_at = now()`;
  await sql`
    INSERT INTO kv (k, v, updated_at) VALUES ('api_usage', ${JSON.stringify(nextUsage)}::jsonb, now())
    ON CONFLICT (k) DO UPDATE SET v = excluded.v, updated_at = now()`;

  if (avCalled) {
    const utc = new Date().toISOString().slice(0, 10);
    const keepDate = av && (av.date === today || av.date === utc) ? av.date : today;
    const used = (av && av.date === keepDate ? av.used : 0) + 1;
    const nextAv = { date: keepDate, used };
    await sql`
      INSERT INTO kv (k, v, updated_at) VALUES ('av_budget', ${JSON.stringify(nextAv)}::jsonb, now())
      ON CONFLICT (k) DO UPDATE SET v = excluded.v, updated_at = now()`;
  }

  const ok = results.filter((r) => r.state === "ok").length;
  const fail = results.filter((r) => r.state === "fail").length;
  const skip = results.filter((r) => r.state === "skip").length;
  return NextResponse.json({ ok, fail, skip, results });
}
