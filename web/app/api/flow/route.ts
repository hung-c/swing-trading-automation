import { NextResponse } from "next/server";

import { rows, getSql } from "@/lib/db";
import { buildFlow, type BriefStamp, type RunInput } from "@/lib/flow";

export const dynamic = "force-dynamic";

function summaryOf(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof v === "object") return v as Record<string, unknown>;
  return null;
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

export async function GET() {
  const now = new Date();
  const sql = getSql();
  if (!sql) {
    return NextResponse.json(buildFlow([], [], now, { configured: false, tableReady: false }));
  }

  let activeStrategy: { id: string; name: string } | null = null;
  try {
    const raw = await sql`
      SELECT id, name FROM strategies
      WHERE status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const row = rows<Record<string, unknown>>(raw)[0];
    if (row) activeStrategy = { id: String(row.id), name: String(row.name) };
  } catch {
    activeStrategy = null;
  }

  let tableReady = true;
  let runs: RunInput[] = [];
  try {
    const raw = await sql`
      SELECT id, job, step, status, started_at, finished_at, summary, error
      FROM (
        SELECT id, job, step, status, started_at, finished_at, summary, error,
               ROW_NUMBER() OVER (PARTITION BY job, step ORDER BY started_at DESC, id DESC) AS rn
        FROM job_runs
      ) ranked
      WHERE rn <= 8
      ORDER BY started_at DESC, id DESC
    `;
    runs = rows<Record<string, unknown>>(raw).map((r) => ({
      id: Number(r.id),
      job: String(r.job),
      step: r.step == null ? null : String(r.step),
      status: String(r.status),
      startedAt: iso(r.started_at) ?? new Date(0).toISOString(),
      finishedAt: iso(r.finished_at),
      summary: summaryOf(r.summary),
      error: r.error == null ? null : String(r.error),
    }));
  } catch {
    tableReady = false;
  }

  let briefs: BriefStamp[] = [];
  try {
    const raw = await sql`
      SELECT kind, created_at FROM briefs
      WHERE kind IN ('nightly', 'premarket', 'eod')
      ORDER BY created_at DESC
      LIMIT 12
    `;
    briefs = rows<Record<string, unknown>>(raw)
      .map((r) => ({ kind: String(r.kind), at: iso(r.created_at) ?? "" }))
      .filter((r) => r.at);
  } catch {
    briefs = [];
  }

  const body = buildFlow(runs, briefs, now, { configured: true, tableReady });
  body.activeStrategy = activeStrategy;
  return NextResponse.json(body);
}
