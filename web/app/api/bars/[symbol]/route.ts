import { NextResponse } from "next/server";
import type { Bar, Frame } from "@/lib/chart-math";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FRAMES: Record<Frame, { interval: string; range: string }> = {
  daily: { interval: "1d", range: "2y" },
  weekly: { interval: "1wk", range: "5y" },
  intraday: { interval: "15m", range: "5d" },
};

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
};

function parseYahoo(body: YahooChart): Bar[] {
  const result = body.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const stamps = result?.timestamp;
  if (!stamps || !quote) return [];
  const bars: Bar[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    if (![o, h, l, c].every(Number.isFinite)) continue;
    bars.push({
      t: stamps[i] * 1000,
      o,
      h,
      l,
      c,
      v: Number.isFinite(quote.volume?.[i]) ? Number(quote.volume?.[i]) : 0,
    });
  }
  bars.sort((a, b) => a.t - b.t);
  return bars;
}

async function loadYahoo(symbol: string, interval: string, range: string): Promise<Bar[]> {
  const yahoo = symbol.replace(/\./g, "-");
  const qs = `interval=${interval}&range=${range}&includePrePost=false`;
  let last = "Quote unavailable";
  for (const host of ["query1", "query2"]) {
    const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?${qs}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      last = `Quote request failed (${res.status})`;
      continue;
    }
    const body = (await res.json()) as YahooChart;
    const description = body.chart?.error?.description;
    if (description) {
      last = description.slice(0, 80);
      continue;
    }
    const bars = parseYahoo(body);
    if (bars.length) return bars;
    last = "No bars in the quote";
  }
  throw new Error(last);
}

export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const frame = new URL(req.url).searchParams.get("frame") ?? "daily";
  if (!/^[A-Za-z0-9.\-]{1,12}$/.test(symbol) || !(frame in FRAMES)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const spec = FRAMES[frame as Frame];
  try {
    const bars = await loadYahoo(symbol.toUpperCase(), spec.interval, spec.range);
    if (!bars.length) return NextResponse.json({ error: "No bars for this symbol" }, { status: 404 });
    return NextResponse.json(
      { symbol: symbol.toUpperCase(), frame, bars },
      { headers: { "cache-control": "private, max-age=120" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load bars";
    console.error("bars", symbol, e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
