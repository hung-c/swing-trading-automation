"""Unified bar access with provider fallback: Alpaca (SIP) -> Massive -> yfinance.

All daily frames: DatetimeIndex (naive session date), columns open/high/low/close/volume[/vwap/trades].
Weekly frames are derived locally (W-FRI) so weekly == our own daily source.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

import pandas as pd

from swing.data import alpaca, massive, yf

log = logging.getLogger(__name__)

REQUIRED = ["open", "high", "low", "close", "volume"]


def _normalize(frames: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    out = {}
    for sym, g in frames.items():
        if g is None or g.empty or not set(REQUIRED).issubset(g.columns):
            continue
        g = g.copy()
        g.index = pd.to_datetime(g.index)
        if g.index.tz is not None:
            g.index = g.index.tz_localize(None)
        g.index = g.index.normalize()
        g = g[~g.index.duplicated(keep="last")].sort_index()
        g.columns.name = None
        g.index.name = "date"
        if "vwap" not in g.columns:
            g["vwap"] = (g["high"] + g["low"] + g["close"]) / 3
        for c in REQUIRED + ["vwap"]:
            g[c] = pd.to_numeric(g[c], errors="coerce")
        out[sym] = g.dropna(subset=["close"])
    return out


def daily(symbols: list[str], years: float = 3.0, end: date | None = None) -> tuple[dict[str, pd.DataFrame], str]:
    """Return ({symbol: df}, provider_name)."""
    end = end or date.today()
    start = end - timedelta(days=int(365.25 * years) + 10)
    symbols = sorted(set(symbols))
    if alpaca.available():
        frames = _normalize(alpaca.daily_bars(symbols, start, end))
        if frames:
            return frames, "alpaca"
        log.warning("alpaca returned no daily bars; falling back")
    if massive.available():
        frames = _normalize(massive.daily_bars(symbols, start, end))
        if frames:
            return frames, "massive"
    log.warning("using yfinance fallback for %d symbols", len(symbols))
    return _normalize(yf.daily_bars(symbols, start, end)), "yfinance"


def weekly(df: pd.DataFrame) -> pd.DataFrame:
    agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    w = df.resample("W-FRI").agg(agg).dropna(subset=["close"])
    return w


def intraday(symbols: list[str], minutes: int, days: int, feed: str = "sip") -> tuple[dict[str, pd.DataFrame], str]:
    if alpaca.available():
        frames = alpaca.intraday_bars(symbols, minutes, days, feed=feed)
        if frames:
            return frames, f"alpaca-{feed}"
    return yf.intraday_bars(symbols, minutes, days), "yfinance"


def latest(symbols: list[str]) -> dict[str, float]:
    if alpaca.available():
        p = alpaca.latest_prices(symbols)
        if p:
            return p
    out = {}
    for s in symbols:
        try:
            import yfinance

            from swing.data.usage import note

            note("yfinance")
            fi = yfinance.Ticker(s).fast_info
            out[s] = float(fi["last_price"])
        except Exception:  # noqa: BLE001
            continue
    return out
