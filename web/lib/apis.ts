export type ApiRow = {
  id: string;
  name: string;
  group: string;
  role: string;
  limit: string;
  dailyCap: number | null;
  keyless: boolean;
  optional: boolean;
};

export const APIS: ApiRow[] = [
  {
    id: "alpaca",
    name: "Alpaca",
    group: "Prices",
    role: "SIP daily and intraday bars, IEX last trade, Benzinga news",
    limit: "200 calls/min",
    dailyCap: null,
    keyless: false,
    optional: false,
  },
  {
    id: "massive",
    name: "Massive",
    group: "Prices",
    role: "Grouped daily bars when Alpaca is unavailable",
    limit: "5 calls/min · EOD · 2 years",
    dailyCap: null,
    keyless: false,
    optional: true,
  },
  {
    id: "yfinance",
    name: "Yahoo Finance",
    group: "Prices",
    role: "Float, ES/NQ futures, and the last-resort bars and news",
    limit: "Unofficial · ~1 call/s",
    dailyCap: null,
    keyless: true,
    optional: true,
  },
  {
    id: "nasdaq",
    name: "Nasdaq",
    group: "Universe",
    role: "Symbol directory plus market cap and sector from the screener",
    limit: "Keyless · cached 12h",
    dailyCap: null,
    keyless: true,
    optional: false,
  },
  {
    id: "sec",
    name: "SEC EDGAR",
    group: "Universe",
    role: "CIK map, SIC, and shares outstanding as a float tiebreaker",
    limit: "10 calls/s",
    dailyCap: null,
    keyless: false,
    optional: true,
  },
  {
    id: "finnhub",
    name: "Finnhub",
    group: "Earnings and news",
    role: "Earnings calendar, company news, and company profile",
    limit: "60 calls/min",
    dailyCap: null,
    keyless: false,
    optional: false,
  },
  {
    id: "alphavantage",
    name: "Alpha Vantage",
    group: "Earnings and news",
    role: "Whole-market earnings calendar and news sentiment on the best setups",
    limit: "25 calls/day",
    dailyCap: 25,
    keyless: false,
    optional: true,
  },
  {
    id: "fred",
    name: "FRED",
    group: "Macro",
    role: "CPI, PPI, NFP, GDP, and PCE release dates",
    limit: "Optional key",
    dailyCap: null,
    keyless: false,
    optional: true,
  },
  {
    id: "bea",
    name: "BEA",
    group: "Macro",
    role: "GDP and PCE release dates",
    limit: "Keyless JSON",
    dailyCap: null,
    keyless: true,
    optional: true,
  },
  {
    id: "bls",
    name: "BLS",
    group: "Macro",
    role: "CPI, PPI, and NFP calendar. A static file covers the dates BLS blocks.",
    limit: "Best effort",
    dailyCap: null,
    keyless: true,
    optional: true,
  },
  {
    id: "groq",
    name: "Groq",
    group: "Writing",
    role: "Prose for the nightly and premarket briefs",
    limit: "Free tier",
    dailyCap: null,
    keyless: false,
    optional: true,
  },
  {
    id: "gemini",
    name: "Gemini",
    group: "Writing",
    role: "Brief prose when Groq is unavailable",
    limit: "Free tier",
    dailyCap: null,
    keyless: false,
    optional: true,
  },
  {
    id: "telegram",
    name: "Telegram",
    group: "Writing",
    role: "Push for actionable alerts and the nightly summary",
    limit: "Bot API",
    dailyCap: null,
    keyless: false,
    optional: true,
  },
];

export type ApiJobUsage = {
  runs: number;
  calls: Record<string, number>;
};

export type ApiUsage = {
  date: string;
  calls: Record<string, number>;
  jobs: Record<string, ApiJobUsage>;
  secrets: Record<string, boolean>;
  updatedAt: string | null;
};

export type AvBudget = { date: string; used: number };

export type ApiTestState = "ok" | "fail" | "skip";

export type ApiTestRow = {
  id: string;
  state: ApiTestState;
  detail: string;
};

export type ApiTest = {
  at: string;
  results: ApiTestRow[];
};

export function todayEt(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}
