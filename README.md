# Swing Trading Automation

Free-API Python pipeline that replaces the manual Finviz / Webull routine in
"Quy Trình Giao Dịch Swing" (`Swing trade Routine.html`). It screens, scores,
writes plan cards, checks market regime, raises intraday alerts and publishes
English daily briefs to Notion. Execution stays manual: you copy the plan card
into a Webull bracket order.

## What runs when (ET, NYSE trading days only)

| Job | Time | What |
| --- | --- | --- |
| `swing premarket` | 07:00 | SPY/QQQ vs MA50/MA200, ES/NQ futures, distribution days, breadth, Faber 10-mo SMA, macro blackout (CPI/PPI/NFP/GDP/FOMC) -> sizing for today |
| `swing intraday` | every 15 min 10:00-15:45 | For each plan: resistance cross, > yesterday close, > VWAP, time-adjusted RVOL > 1.5, no-chase flag. 15:45 run also does position management (failed breakout exit, sell half at 2R, trail under 8 EMA, earnings <= 2 days) |
| `swing nightly` | 16:35 (13:35 early close) | Universe -> Alpaca SIP bars -> Scan A (Finviz replica + ladder) -> RS / Trend Template -> weekly clear-sky + overhead supply -> 8-point trend score -> patterns (flag, flat base, ascending triangle, cup & handle, VCP score) -> plan cards (entry/stop/size/2R) -> news -> Groq prose -> Notion brief + charts |

## Data sources (all free for personal use, verified 2026-10-07)

- Prices: Alpaca Market Data Basic (paper account; `feed=sip` for history older than 15 min). Fallback: Massive grouped-daily, yfinance.
- Universe / market cap / sector: Nasdaq Trader symbol directory + Nasdaq.com screener JSON; yfinance `info` for sector/float; SEC EDGAR as tiebreaker.
- Earnings: Finnhub calendar (primary), yfinance `calendar` (confirmed/estimate flag), Alpha Vantage CSV (cross-check).
- News: Alpaca News (Benzinga) + Alpha Vantage `NEWS_SENTIMENT`. Fallback: Finnhub company-news.
- Macro: BLS ICS, BEA schedule, FOMC dates in `data/fomc.yaml`.
- LLM prose: Groq (free) -> Gemini (free) -> plain template.
- Publishing: Notion API (internal integration, direct file upload for chart PNGs).

## Setup

1. `uv sync --extra dev`
2. Copy `.env.example` to `.env` and fill the keys (see comments in the file for where to get each one).
3. `uv run swing check` — verifies config, calendar and which secrets are present.
4. `uv run swing setup-notion` — creates the "Swing Trading System" page and the Daily Briefs / Plans / Positions / Alerts databases under `NOTION_PARENT_PAGE_ID` (idempotent; ids are stored in `state/notion_ids.json`).
5. `uv run swing nightly --dry-run --limit 300` — first end-to-end run without publishing.
6. Add the same keys as GitHub repository secrets; the workflows in `.github/workflows/` run on cron.

All thresholds live in `config.yaml` (account size, risk %, Scan A filters and ladder, pattern geometry, regime table).

## Layout

```
src/swing/
  config.py          config.yaml + .env
  models.py          Pydantic contracts between agents
  calendars.py       NYSE sessions, early closes, ET clock
  indicators.py      SMA/EMA/ATR/ADR/RS rating/BB width/VWAP/RVOL
  patterns.py        pivots, base detection, four patterns, VCP, overhead supply
  charts.py          mplfinance PNGs (weekly / daily / 15-min + VWAP)
  journal.py         SQLite: plans, positions, alerts, R-multiples, heat
  llm.py             Groq / Gemini / template brief writer (Pydantic-validated)
  notion_publisher.py
  jobs.py            nightly / premarket / intraday orchestration
  data/              alpaca, nasdaq, finnhub, alphavantage, yfinance, massive, sec, macro, news
  agents/            universe, screener, pattern, risk, regime, news, brief, alerts, manage
tests/               fixture bars per pattern + Finviz filter parity tests
state/               journal.sqlite (committed by the workflow), notion_ids.json
```

## Not automated on purpose

- Order placement (plan card -> Webull bracket by hand).
- Any paid data (Finviz Elite, Finnhub candles, FMP screener, TradingView webhooks).
