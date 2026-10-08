import { NextResponse } from "next/server";
import { saveStrategy } from "@/lib/strategies";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  try {
    const result = await saveStrategy(null, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, id: result.id });
  } catch (e) {
    console.error("strategies create", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
