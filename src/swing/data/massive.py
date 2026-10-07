"""Massive (formerly Polygon.io) Stocks Basic: 5 req/min, EOD only, 2 years.

Used as the fallback for daily bars: the grouped-daily endpoint returns the whole US market in one call,
so a 2-year backfill is ~504 calls (~100 min). The nightly incremental is one call.
"""

from __future__ import annotations

import logging
import time
from datetime import date, timedelta

import pandas as pd

from swing.calendars import trading_days
from swing.config import env
from swing.data.http import get

log = logging.getLogger(__name__)
BASE = "https://api.massive.com"


def available() -> bool:
    return bool(env("MASSIVE_KEY"))


def grouped_daily(d: date) -> pd.DataFrame:
    data = get(
        f"{BASE}/v2/aggs/grouped/locale/us/market/stocks/{d.isoformat()}",
        params={"adjusted": "true", "apiKey": env("MASSIVE_KEY")},
        ttl_seconds=30 * 86400,  # a past day never changes
    )
    rows = data.get("results") or []
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df = df.rename(columns={"T": "symbol", "o": "open", "h": "high", "l": "low", "c": "close", "v": "volume", "vw": "vwap", "n": "trades"})
    df["date"] = pd.Timestamp(d)
    return df[["symbol", "date", "open", "high", "low", "close", "volume", "vwap", "trades"]]


def daily_bars(symbols: list[str], start: date, end: date | None = None, max_calls: int | None = None) -> dict[str, pd.DataFrame]:
    """Build per-symbol frames from grouped-daily calls, newest first, respecting 5 req/min."""
    if not available():
        return {}
    end = end or (date.today() - timedelta(days=1))
    days = list(reversed(trading_days(start, end)))
    if max_calls:
        days = days[:max_calls]
    frames = []
    for i, d in enumerate(days):
        try:
            frames.append(grouped_daily(d))
        except Exception as e:  # noqa: BLE001
            log.warning("massive grouped %s failed: %s", d, e)
        if i and i % 5 == 0:
            time.sleep(61)  # free tier 5/min
    if not frames:
        return {}
    allrows = pd.concat(frames, ignore_index=True)
    want = set(symbols)
    out: dict[str, pd.DataFrame] = {}
    for sym, g in allrows[allrows["symbol"].isin(want)].groupby("symbol"):
        g = g.set_index("date").sort_index().drop(columns="symbol")
        out[str(sym)] = g
    return out
