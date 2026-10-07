"""Alpaca Market Data Basic (free with a paper-only account).

Rules that matter on the free plan (verified 2026-10-07):
- feed=sip is allowed for any window whose `end` is >= 15 minutes in the past -> consolidated volume.
- feed=iex is real-time but ~2-3% of volume; use it only for the latest price, never for volume.
- 200 REST calls/min; multi-symbol bars endpoint pages at 10,000 bars.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache

import pandas as pd

from swing.config import env
from swing.models import NewsItem

log = logging.getLogger(__name__)

SIP_LAG = timedelta(minutes=16)
SYMBOL_CHUNK = 200  # keeps the URL under limits


@lru_cache(maxsize=1)
def _client():
    from alpaca.data.historical import StockHistoricalDataClient

    return StockHistoricalDataClient(env("ALPACA_KEY", required=True), env("ALPACA_SECRET", required=True))


def available() -> bool:
    return bool(env("ALPACA_KEY") and env("ALPACA_SECRET"))


def _sip_end(end: datetime | None) -> datetime:
    now = datetime.now(UTC)
    e = end or now
    if e.tzinfo is None:
        e = e.replace(tzinfo=UTC)
    return min(e, now - SIP_LAG)


def _to_frames(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """alpaca-py returns MultiIndex (symbol, timestamp). Return per-symbol frames with standard columns."""
    out: dict[str, pd.DataFrame] = {}
    if df is None or df.empty:
        return out
    df = df.rename(columns={"trade_count": "trades"})
    cols = [c for c in ("open", "high", "low", "close", "volume", "vwap", "trades") if c in df.columns]
    for sym, g in df.groupby(level=0):
        g = g.droplevel(0)[cols].copy()
        g.index = pd.to_datetime(g.index, utc=True).tz_convert("America/New_York")
        out[str(sym)] = g
    return out


def daily_bars(symbols: list[str], start: date, end: date | None = None) -> dict[str, pd.DataFrame]:
    """Split-adjusted daily SIP bars. Index = session date (naive), columns open/high/low/close/volume/vwap/trades."""
    from alpaca.data.enums import Adjustment, DataFeed
    from alpaca.data.requests import StockBarsRequest
    from alpaca.data.timeframe import TimeFrame

    client = _client()
    end_dt = _sip_end(datetime.combine(end, datetime.max.time(), tzinfo=UTC) if end else None)
    out: dict[str, pd.DataFrame] = {}
    for i in range(0, len(symbols), SYMBOL_CHUNK):
        chunk = symbols[i : i + SYMBOL_CHUNK]
        req = StockBarsRequest(
            symbol_or_symbols=chunk,
            timeframe=TimeFrame.Day,
            start=datetime.combine(start, datetime.min.time(), tzinfo=UTC),
            end=end_dt,
            feed=DataFeed.SIP,
            adjustment=Adjustment.SPLIT,
            # no `limit`: in alpaca-py it caps TOTAL bars across all symbols (10k = ~13 symbols x 3y); unset -> paginate all
        )
        try:
            bars = client.get_stock_bars(req)
        except Exception as e:  # noqa: BLE001
            log.warning("alpaca daily bars chunk %d failed: %s", i // SYMBOL_CHUNK, e)
            continue
        frames = _to_frames(bars.df if hasattr(bars, "df") else pd.DataFrame())
        for sym, g in frames.items():
            g.index = pd.DatetimeIndex([ts.date() for ts in g.index], name="date")
            g.index = pd.to_datetime(g.index)
            out[sym] = g[~g.index.duplicated(keep="last")].sort_index()
        log.info("alpaca daily: %d/%d symbols fetched", len(out), len(symbols))
    return out


def intraday_bars(
    symbols: list[str], minutes: int, days: int, feed: str = "sip", end: datetime | None = None
) -> dict[str, pd.DataFrame]:
    """Intraday bars. feed='sip' is lagged 16 min (free); feed='iex' is live but thin volume."""
    from alpaca.data.enums import Adjustment, DataFeed
    from alpaca.data.requests import StockBarsRequest
    from alpaca.data.timeframe import TimeFrame, TimeFrameUnit

    client = _client()
    now = datetime.now(UTC)
    end_dt = _sip_end(end) if feed == "sip" else (end or now)
    start_dt = end_dt - timedelta(days=days + 4)  # pad for weekends/holidays
    req = StockBarsRequest(
        symbol_or_symbols=symbols,
        timeframe=TimeFrame(minutes, TimeFrameUnit.Minute),
        start=start_dt,
        end=end_dt,
        feed=DataFeed.SIP if feed == "sip" else DataFeed.IEX,
        adjustment=Adjustment.SPLIT,
    )
    try:
        bars = client.get_stock_bars(req)
    except Exception as e:  # noqa: BLE001
        log.warning("alpaca intraday bars failed: %s", e)
        return {}
    frames = _to_frames(bars.df)
    # keep regular session only
    for sym, g in frames.items():
        t = g.index.time
        mask = (t >= pd.Timestamp("09:30").time()) & (t < pd.Timestamp("16:00").time())
        frames[sym] = g[mask]
    return frames


def latest_prices(symbols: list[str]) -> dict[str, float]:
    """Real-time last trade from IEX (free). Price only; do not use its size for volume."""
    from alpaca.data.enums import DataFeed
    from alpaca.data.requests import StockLatestTradeRequest

    try:
        res = _client().get_stock_latest_trade(StockLatestTradeRequest(symbol_or_symbols=symbols, feed=DataFeed.IEX))
    except Exception as e:  # noqa: BLE001
        log.warning("alpaca latest trade failed: %s", e)
        return {}
    return {sym: float(t.price) for sym, t in res.items()}


def news(symbols: list[str], days: int, limit: int = 50) -> list[NewsItem]:
    """Benzinga-sourced news via Alpaca (free). Returns items tagged with every symbol they mention."""
    from alpaca.data.historical.news import NewsClient
    from alpaca.data.requests import NewsRequest

    client = NewsClient(env("ALPACA_KEY", required=True), env("ALPACA_SECRET", required=True))
    start = datetime.now(UTC) - timedelta(days=days)
    out: list[NewsItem] = []
    try:
        res = client.get_news(NewsRequest(symbols=",".join(symbols), start=start, limit=limit, include_content=False))
    except Exception as e:  # noqa: BLE001
        log.warning("alpaca news failed: %s", e)
        return out
    items = res.data.get("news", []) if hasattr(res, "data") else getattr(res, "news", [])
    for n in items:
        syms = [s for s in (n.symbols or []) if s in symbols] or symbols[:1]
        for s in syms:
            out.append(
                NewsItem(
                    symbol=s,
                    headline=n.headline or "",
                    source=n.source or "benzinga",
                    url=str(n.url or ""),
                    published=n.created_at,
                    summary=(n.summary or "")[:400],
                    provider="alpaca",
                )
            )
    return out
