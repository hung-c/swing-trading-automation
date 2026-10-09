# Swing Trading Automation

Free-API Python pipeline that replaces the manual Finviz / Webull routine in
"Quy Trình Giao Dịch Swing" (`Swing trade Routine.html`). It screens, scores,
writes plan cards, checks market regime, raises intraday alerts and publishes
English daily briefs to a **Vercel dashboard**. Execution stays manual: you copy
the plan card into a Webull bracket order.

Vercel cannot run the pandas/Alpaca nightly job (too heavy, too slow). A Windows
PC runs the jobs on Task Scheduler and writes them to Neon. The Next.js app in
`web/` is the reading surface. GitHub Actions only runs tests on push.

## What runs when (ET, NYSE trading days only)

The job PC runs one task, **Swing Tick**, every 15 minutes from 07:03 to 19:03 on weekdays. `swing tick` reads strategies with status `active` and starts whichever of these jobs is due. Start times are edited on each strategy's clock. Draft and paused strategies do not schedule anything. If two active strategies set different times, the earlier start wins.

| Job | Default | What |
| --- | --- | --- |
| `swing premarket` | once at 07:03 | SPY/QQQ vs MA50/MA200, ES/NQ futures, distribution days / follow-through, breadth, Faber 10-mo SMA, macro blackout (CPI/PPI/NFP/GDP/FOMC) -> sizing for today |
| `swing intraday` | every 15 min, 10:00-15:50 | For each plan: resistance cross, > yesterday close, > VWAP, time-adjusted RVOL > 1.5, no-chase (> +1%) flag; stop / 2R checks for positions. The pass near the close also does management (failed-breakout exit, sell half at 2R, trail under 8 EMA, earnings <= 2 days) |
| `swing nightly` | once at 16:37 (13:37 on early-close days) | Universe -> SIP bars -> Scan A -> weekly clear-sky + overhead supply -> 8-point trend score -> patterns -> plan cards -> news -> Groq prose -> Neon (briefs, plans, chart PNGs). A start time other than 16:37 is used as written, including on early-close days. |
| `swing report` | Friday 17:11, off until a strategy turns it on | Expectancy / SQN per pattern from the trade journal |

A once-a-day job does not run again after it succeeds. A failed run is tried on the next tick. Intraday waits 15 minutes after a success.

Install that task on the job PC (it removes the older Premarket, Intraday, Nightly, and Report tasks):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\swing-trading-strategy\scripts\install-tick.ps1
```

The PC has to stay logged in and awake. `Get-ScheduledTask -TaskName 'Swing Tick'` should be the only Swing task. GitHub Actions does not schedule these jobs.

All thresholds live in `config.yaml` (account size, risk %, Scan A filters and ladder, pattern geometry, regime table).

## Data sources (free for personal use, verified 2026-10-07)

- Prices: Alpaca Market Data Basic (paper account; `feed=sip` for windows ending > 15 min ago gives consolidated volume). Fallback: Massive grouped-daily, then yfinance.
- Universe / market cap / sector: Nasdaq Trader symbol directory + Nasdaq.com screener JSON (keyless). yfinance `info` for float; SEC EDGAR as tiebreaker.
- Earnings: Finnhub calendar (primary), yfinance `calendar`, Alpha Vantage CSV. Without Finnhub/AV keys it falls back to yfinance per symbol.
- News: Alpaca News (Benzinga). Alpha Vantage `NEWS_SENTIMENT` is premium so it is skipped on the free key. Fallback: Finnhub company-news, yfinance news.
- Macro: `data/macro_static.yaml` (CPI/PPI/NFP; bls.gov blocks scripts), BEA JSON (GDP/PCE), FRED (optional key), `data/fomc.yaml`.
- LLM prose: Groq (free) -> Gemini (free) -> plain template. The model only writes prose; every number comes from code and the output is Pydantic-validated.
- Delivery: Vercel Next.js app (`web/`) reading Neon. Optional Telegram push for actionable alerts.

## Setup

### 1. Pipeline (Python)

1. `uv sync --extra dev`
2. Copy `.env.example` to `.env` and fill the keys. Minimum useful set: `ALPACA_KEY/SECRET` (paper), `FINNHUB_KEY`, `GROQ_KEY`, **`DATABASE_URL`**.
3. `uv run swing check` — config, calendar and which secrets are present.
4. `uv run swing nightly --dry-run --force --limit 300` — first end-to-end run without writing the database; markdown + charts land in `out/`.

### 2. Database (Neon, required)

The journal is **only** Neon. The PC jobs, a local `swing nightly`, and the Vercel app all use the same `DATABASE_URL`. SQLite exists solely inside pytest (`path=` tmp files).

1. Create a project at [console.neon.tech](https://console.neon.tech). Copy the connection string (`sslmode=require`).
2. Put it in `.env` as `DATABASE_URL=...`
3. `uv run swing db-init` — creates the tables in `db/schema.sql`.
4. Add the same `DATABASE_URL` as a **Vercel env var**.

If `DATABASE_URL` is missing, jobs refuse to run (they will not fall back to sqlite).

### 3. Dashboard (Vercel)

1. Import this GitHub repo in [vercel.com](https://vercel.com/new).
2. Set **Root Directory** to `web`.
3. Environment variables: `DATABASE_URL` (same Neon string) and optional `DASHBOARD_PASSWORD` (gates the UI).
4. Deploy. Local preview: `cd web && npm install && npm run dev` (needs `web/.env.local` with `DATABASE_URL`).
5. After the next `swing nightly` the Today page fills in.

Vercel Hobby is enough — the app only reads Postgres.

## Recording trades

Execution is manual. Log fills on the **Positions** page, or from Python:

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
  journal.py         Neon journal (sqlite only in tests)
  jobs.py            nightly / premarket / intraday / report
  tick.py            15-minute due check over active strategy clocks
  cli.py             swing check | should-run | tick | nightly | premarket | intraday | db-init | db-push | report | parity
  ...
web/                 Next.js App Router dashboard (Vercel)
db/schema.sql        Postgres schema shared with the web app
tests/
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
