import type { ApiTestRow } from "./apis";
import { todayEt } from "./apis";
import { pipelineEnv } from "./pipeline-env";

const BROWSER = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

type Hit = { status: number; body: string };

async function hit(url: string, init?: RequestInit, secrets: string[] = []): Promise<Hit> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000), cache: "no-store" });
  let body = (await res.text()).replace(/\s+/g, " ").slice(0, 160);
  for (const secret of secrets) {
    if (secret) body = body.split(secret).join("…");
  }
  return { status: res.status, body };
}

function fromStatus(id: string, status: number, body: string, okBody?: (body: string) => boolean): ApiTestRow {
  const ok = status >= 200 && status < 300 && (okBody ? okBody(body) : true);
  if (ok) return { id, state: "ok", detail: String(status) };
  const why = body.replace(/<[^>]+>/g, "").slice(0, 80);
  return { id, state: "fail", detail: why ? `${status} ${why}` : String(status) };
}

function skip(id: string, detail: string): ApiTestRow {
  return { id, state: "skip", detail };
}

async function safe(id: string, run: () => Promise<ApiTestRow>): Promise<ApiTestRow> {
  try {
    return await run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { id, state: "fail", detail: msg.slice(0, 80) };
  }
}

export async function probeApis(avUsedToday: number): Promise<ApiTestRow[]> {
  const alpacaKey = pipelineEnv("ALPACA_KEY");
  const alpacaSecret = pipelineEnv("ALPACA_SECRET");
  const massive = pipelineEnv("MASSIVE_KEY");
  const finnhub = pipelineEnv("FINNHUB_KEY");
  const av = pipelineEnv("ALPHAVANTAGE_KEY");
  const fred = pipelineEnv("FRED_KEY");
  const groq = pipelineEnv("GROQ_KEY");
  const gemini = pipelineEnv("GEMINI_KEY");
  const tgToken = pipelineEnv("TELEGRAM_BOT_TOKEN");
  const tgChat = pipelineEnv("TELEGRAM_CHAT_ID");
  const secUa = pipelineEnv("SEC_USER_AGENT") || "swing-trading-personal contact@example.com";

  return Promise.all([
    safe("alpaca", async () => {
      if (!alpacaKey || !alpacaSecret) return skip("alpaca", "No key on this server");
      const r = await hit("https://data.alpaca.markets/v2/stocks/SPY/trades/latest?feed=iex", {
        headers: { "APCA-API-KEY-ID": alpacaKey, "APCA-API-SECRET-KEY": alpacaSecret },
      }, [alpacaKey, alpacaSecret]);
      return fromStatus("alpaca", r.status, r.body);
    }),
    safe("massive", async () => {
      if (!massive) return skip("massive", "No key on this server");
      const r = await hit(
        `https://api.massive.com/v2/aggs/ticker/SPY/prev?adjusted=true&apiKey=${encodeURIComponent(massive)}`,
        undefined,
        [massive],
      );
      return fromStatus("massive", r.status, r.body);
    }),
    safe("yfinance", async () => {
      const r = await hit("https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1d", {
        headers: BROWSER,
      });
      return fromStatus("yfinance", r.status, r.body);
    }),
    safe("nasdaq", async () => {
      const r = await hit(
        "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=1&offset=0&exchange=nasdaq",
        { headers: { ...BROWSER, Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" } },
      );
      return fromStatus("nasdaq", r.status, r.body);
    }),
    safe("sec", async () => {
      const r = await hit("https://www.sec.gov/files/company_tickers.json", {
        headers: { "User-Agent": secUa, Accept: "application/json" },
      });
      return fromStatus("sec", r.status, r.body);
    }),
    safe("finnhub", async () => {
      if (!finnhub) return skip("finnhub", "No key on this server");
      const r = await hit(
        `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(finnhub)}`,
        undefined,
        [finnhub],
      );
      return fromStatus("finnhub", r.status, r.body);
    }),
    safe("alphavantage", async () => {
      if (!av) return skip("alphavantage", "No key on this server");
      if (avUsedToday >= 25) return skip("alphavantage", "Daily budget already 25/25");
      const r = await hit(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=SPY&apikey=${encodeURIComponent(av)}`,
        undefined,
        [av],
      );
      const blocked = /premium|rate limit|thank you for using|note|information/i.test(r.body);
      if (r.status >= 200 && r.status < 300 && !blocked) return { id: "alphavantage", state: "ok", detail: "200" };
      if (blocked) return { id: "alphavantage", state: "fail", detail: r.body.slice(0, 80) };
      return fromStatus("alphavantage", r.status, r.body);
    }),
    safe("fred", async () => {
      if (!fred) return skip("fred", "No key on this server");
      const r = await hit(
        `https://api.stlouisfed.org/fred/series?series_id=GDP&api_key=${encodeURIComponent(fred)}&file_type=json`,
        undefined,
        [fred],
      );
      return fromStatus("fred", r.status, r.body);
    }),
    safe("bea", async () => {
      const r = await hit("https://apps.bea.gov/API/signup/release_dates.json", { headers: BROWSER });
      return fromStatus("bea", r.status, r.body);
    }),
    safe("bls", async () => {
      const r = await hit("https://www.bls.gov/schedule/news_release/bls.ics", { headers: BROWSER });
      return fromStatus("bls", r.status, r.body);
    }),
    safe("groq", async () => {
      if (!groq) return skip("groq", "No key on this server");
      const r = await hit("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${groq}` },
      }, [groq]);
      return fromStatus("groq", r.status, r.body);
    }),
    safe("gemini", async () => {
      if (!gemini) return skip("gemini", "No key on this server");
      const r = await hit("https://generativelanguage.googleapis.com/v1beta/openai/models", {
        headers: { Authorization: `Bearer ${gemini}` },
      }, [gemini]);
      return fromStatus("gemini", r.status, r.body);
    }),
    safe("telegram", async () => {
      if (!tgToken || !tgChat) return skip("telegram", "No key on this server");
      const r = await hit(`https://api.telegram.org/bot${tgToken}/getMe`, undefined, [tgToken]);
      return fromStatus("telegram", r.status, r.body);
    }),
  ]);
}

export function avSpent(av: { date: string; used: number } | null, now = new Date()): number {
  if (!av) return 0;
  const utc = now.toISOString().slice(0, 10);
  if (av.date === todayEt(now) || av.date === utc) return av.used;
  return 0;
}
