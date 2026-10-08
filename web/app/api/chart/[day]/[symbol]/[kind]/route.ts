import { NextResponse } from "next/server";
import { loadChartPng } from "@/lib/queries";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ day: string; symbol: string; kind: string }> },
) {
  const { day, symbol, kind } = await ctx.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[A-Z.]{1,10}$/i.test(symbol) || !/^[a-z0-9_-]+$/i.test(kind)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    const png = await loadChartPng(day, symbol, kind);
    if (!png) return new NextResponse("not found", { status: 404 });
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=300",
      },
    });
  } catch (e) {
    console.error("chart", e);
    return NextResponse.json({ error: "chart failed" }, { status: 500 });
  }
}
