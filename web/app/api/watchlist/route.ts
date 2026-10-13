import { NextResponse } from "next/server";
import { deleteWatch, saveWatch } from "@/lib/watchlist";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { symbol?: unknown };
  try {
    const result = await saveWatch(String(body.symbol ?? ""));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("watchlist save", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { symbol?: unknown };
  try {
    const result = await deleteWatch(String(body.symbol ?? ""));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("watchlist delete", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
