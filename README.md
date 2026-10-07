# Swing Trading Automation

Free-API Python pipeline that replaces the manual Finviz / Webull routine in
"Quy Trình Giao Dịch Swing" (`Swing trade Routine.html`). It screens, scores,
writes plan cards, checks market regime, raises intraday alerts and publishes
English daily briefs to Notion. Execution stays manual: you copy the plan card
into a Webull bracket order.

## What runs when (ET, NYSE trading days only)

| Job | Cron (ET) | What |
| --- | --- | --- |
| `swing premarket` | 07:03 | SPY/QQQ vs MA50/MA200, ES/NQ futures, distribution days / follow-through, breadth, Faber 10-mo SMA, macro blackout (CPI/PPI/NFP/GDP/FOMC) -> sizing for today |
| `swing intraday` | :03/:18/:33/:48, 10:00-15:50 | For each plan: resistance cross, > yesterday close, > VWAP, time-adjusted RVOL > 1.5, no-chase (> +1%) flag; stop / 2R checks for positions. The 15:48 run also does management (failed-breakout exit, sell half at 2R, trail under 8 EMA, earnings <= 2 days) |
| `swing nightly` | 16:37 (13:37 on early-close days) | Universe -> SIP bars -> Scan A (Finviz replica + ladder) -> RS rating / Trend Template -> weekly clear-sky + overhead supply -> 8-point trend score -> patterns (bull flag, flat base, ascending triangle, cup & handle, VCP/tightness score) -> plan cards (entry / stop / size / 2R) -> news -> Groq prose -> Notion brief + charts |
| `swing report` | Fri 17:11 | Expectancy / SQN per pattern from the trade journal |

All thresholds live in `config.yaml` (account size, risk %, Scan A filters and ladder, pattern geometry, regime table).

## Data sources (free for personal use, verified 2026-10-07)

- Prices: Alpaca Market Data Basic (paper account; `feed=sip` for windows ending > 15 min ago gives consolidated volume). Fallback: Massive grouped-daily, then yfinance.
- Universe / market cap / sector: Nasdaq Trader symbol directory + Nasdaq.com screener JSON (keyless). yfinance `info` for float; SEC EDGAR as tiebreaker.
- Earnings: Finnhub calendar (primary, one call for the whole market), yfinance `calendar` (only free source with a confirmed/estimate flag; estimated dates widen the exclusion window), Alpha Vantage CSV (cross-check). Without Finnhub/AV keys it falls back to yfinance per symbol.
- News: Alpaca News (Benzinga) + Alpha Vantage `NEWS_SENTIMENT` (budgeted, 25 calls/day). Fallback: Finnhub company-news, yfinance news. Red-flag keywords (offering, downgrade, investigation, guidance cut...) are surfaced on the plan card.
- Macro: `data/macro_static.yaml` (CPI/PPI/NFP; bls.gov blocks scripts), BEA JSON (GDP/PCE), FRED (optional key), `data/fomc.yaml`.
- LLM prose: Groq (free) -> Gemini (free) -> plain template. The model only writes prose; every number comes from code and the output is Pydantic-validated.
- Publishing: Notion API 2025-09-03 (internal integration; databases with data sources; chart PNGs via the File Upload API). Optional Telegram push for actionable alerts.

## Setup

1. `uv sync --extra dev`
2. Copy `.env.example` to `.env` and fill the keys (each key has a link in the file). Minimum useful set: `ALPACA_KEY/SECRET` (paper), `FINNHUB_KEY`, `GROQ_KEY`, `NOTION_TOKEN` + `NOTION_PARENT_PAGE_ID`.
3. `uv run swing check` — config, calendar and which secrets are present.
4. `uv run swing setup-notion` — creates the "Swing Trading System" page with the Daily Briefs / Plans / Positions / Alerts databases under your parent page (share the parent page with the integration first). Ids are stored in `state/notion_ids.json`.
5. `uv run swing nightly --dry-run --force --limit 300` — first end-to-end run without publishing; output in `out/` (markdown brief + charts).
6. Push to a private GitHub repo and add the same keys as repository secrets. Workflows are in `.github/workflows/` (ET timezone, holiday/early-close guard, state committed back after each run). Budget is ~900 of the 2,000 free minutes/month.
7. Validate for two weeks on paper: compare the nightly list with the Finviz URL printed at the bottom of each brief, and note GitHub cron drift (5-30 min is normal; if it matters, move the intraday job to Google Cloud Scheduler).

## Recording trades

Execution is manual, so tell the journal what you did (Notion mirrors it on the next run):

```python
from datetime import date
from swing import journal
from swing.models import Position
journal.upsert_position(Position(symbol="XYZ", opened=date.today(), entry=53.31, stop=50.08, initial_stop=50.08,
                                 shares=7, target_2r=59.77, resistance=53.04, pattern="flat_base", sector="Technology"))
journal.close_position("XYZ", exit_price=59.80, closed=date.today())
```

## Layout

```
src/swing/
  config.py          config.yaml + .env
  models.py          Pydantic contracts between agents
  calendars.py       NYSE sessions, early closes, ET clock
  indicators.py      SMA/EMA/ATR/ADR/RS rating/BB width/VWAP/time-adjusted RVOL
  patterns.py        pivots, base detection, four patterns, VCP, overhead supply, base count, trend score
  charts.py          mplfinance PNGs (weekly 3y / daily 6mo / 15-min + VWAP)
  journal.py         SQLite: plans, positions, trades, alerts, briefs
  llm.py             Groq / Gemini / template brief writer (Pydantic-validated)
  notion_publisher.py
  jobs.py            nightly / premarket / intraday / report orchestration
  cli.py             swing check | should-run | nightly | premarket | intraday | setup-notion | report | parity
  data/              nasdaq, alpaca, massive, yf, finnhub, alphavantage, sec, earnings, bars, macro, http
  agents/            universe, screener, pattern, risk, regime, news, alerts, manage
  extras/            report (expectancy/SQN), telegram, parity (tradingview-screener), backtest harness
tests/               synthetic fixtures per pattern, Finviz filter tests, alert/manage/regime tests
state/               journal.sqlite, notion_ids.json, av_budget.json (committed by the workflows)
```

## Notes from the first live runs

- Scan A on the 300-400 largest names returned 46-51 strict hits; Finviz showed 70 for the full market the same day. Expect 20-80 after the full universe.
- Plans rejected for "stop > 12%" are the doc working as written (flat bases 13-15% deep are too loose). The doc's second stop option (under a tested support level inside the base) is tried automatically before rejecting.
- On a $5,000 account many $200+ stocks size to 0-1 shares; those are listed as rejected with the reason so you can decide on fractional shares.
- The distribution-day count only forces "no new entries" when the index is also >= 3% off its highs; near highs it downgrades to half size.
- `python -m swing.extras.backtest NVDA ...` shows the breakout-volume rule (>= 1.5x 50-day average) is rarely met by mega-caps; the rules fit mid-caps better. Survivorship-biased, do not tune thresholds on it.

## Not automated on purpose

- Order placement (plan card -> Webull bracket by hand).
- Any paid data (Finviz Elite, Finnhub candles, FMP screener, TradingView webhooks). `finvizfinance` scraping was rejected (ToS + Cloudflare).
