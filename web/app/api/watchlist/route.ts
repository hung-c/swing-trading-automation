import { NextResponse } from "next/server";
import { addWatch, deleteWatch, saveWatch, setWatchActive, switchWatch } from "@/lib/watchlist";

export const runtime = "nodejs";

type Result = { ok: true } | { ok: false; error: string; status: number };

function json(result: Result) {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; symbol?: unknown; id?: unknown; retireId?: unknown };
  const action = String(body.action ?? "save");
  try {
    let result: Result;
    if (action === "add") result = await addWatch(String(body.id ?? ""));
    else if (action === "switch") result = await switchWatch(String(body.id ?? ""), String(body.retireId ?? ""));
    else if (action === "off") result = await setWatchActive(String(body.id ?? ""), false);
    else if (action === "on") result = await setWatchActive(String(body.id ?? ""), true);
    else result = await saveWatch(String(body.symbol ?? ""));
    return json(result);
  } catch (e) {
    console.error("watchlist save", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  try {
    return json(await deleteWatch(String(body.id ?? "")));
  } catch (e) {
    console.error("watchlist delete", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
