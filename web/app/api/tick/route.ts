import { NextResponse } from "next/server";

import { getSql } from "@/lib/db";
import { loadTickStatus } from "@/lib/load-tick-status";
import { isJobName, TICK_QUEUE_PREFIX } from "@/lib/tick-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await loadTickStatus();
  return NextResponse.json(status);
}

export async function POST(req: Request) {
  return setQueue(req, true);
}

export async function DELETE(req: Request) {
  return setQueue(req, false);
}

async function setQueue(req: Request, queued: boolean) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "DATABASE_URL missing" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { job?: unknown };
  const job = String(body.job ?? "");
  if (!isJobName(job)) return NextResponse.json({ error: "Unknown job" }, { status: 400 });

  const key = `${TICK_QUEUE_PREFIX}${job}`;
  try {
    if (queued) {
      const payload = JSON.stringify({ at: new Date().toISOString() });
      await sql`
        INSERT INTO kv (k, v, updated_at) VALUES (${key}, ${payload}::jsonb, now())
        ON CONFLICT (k) DO UPDATE SET v = excluded.v, updated_at = now()`;
    } else {
      await sql`DELETE FROM kv WHERE k = ${key}`;
    }
  } catch (error) {
    console.error("tick queue", error);
    return NextResponse.json({ error: "Could not update the queue" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, job, queued });
}
