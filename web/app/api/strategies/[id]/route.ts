import { NextResponse } from "next/server";
import { deleteStrategy, saveStrategy } from "@/lib/strategies";

export const runtime = "nodejs";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  try {
    const result = await saveStrategy(id, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, id: result.id });
  } catch (e) {
    console.error("strategies update", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const result = await deleteStrategy(id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("strategies delete", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
