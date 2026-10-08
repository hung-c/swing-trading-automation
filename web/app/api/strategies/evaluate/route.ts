import { NextResponse } from "next/server";
import { buildReview } from "@/lib/strategy-review-llm";
import { normalizeStrategy } from "@/lib/strategy";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const src = body && typeof body === "object" ? (body as { profile?: { name?: unknown } }) : null;
  const name = String(src?.profile?.name ?? "").trim();
  const named =
    src && !name
      ? { ...src, profile: { ...(src.profile ?? {}), name: "Draft" } }
      : body;
  const parsed = normalizeStrategy(named);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const review = await buildReview(parsed.strategy);
    return NextResponse.json(review);
  } catch (e) {
    console.error("strategy evaluate", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
