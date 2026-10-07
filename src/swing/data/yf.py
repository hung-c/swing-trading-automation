"""yfinance (unofficial, ToS-grey). Used only where nothing else is free:
- Ticker.calendar -> earnings date + `Is Earnings Date Estimate` flag
- Ticker.info     -> sector / industry / floatShares (weekly refresh)
- ES=F / NQ=F     -> futures % change for the pre-market regime check
- bars fallback   -> if Alpaca and Massive are both unavailable
Throttled to ~1 req/s; every call is wrapped so failures degrade to None.
"""

from __future__ import annotations

import logging
import time
from datetime import date, datetime

import pandas as pd

from swing.models import EarningsInfo

log = logging.getLogger(__name__)
_last_call = 0.0


def _throttle(min_gap: float = 1.0) -> None:
    global _last_call
    gap = time.time() - _last_call
    if gap < min_gap:
        time.sleep(min_gap - gap)
    _last_call = time.time()


def earnings(symbol: str) -> EarningsInfo | None:
    import yfinance as yf

    _throttle()
    try:
        cal = yf.Ticker(symbol).calendar
    except Exception as e:  # noqa: BLE001
        log.debug("yf calendar %s failed: %s", symbol, e)
        return None
    if not cal:
        return None
    dates = cal.get("Earnings Date") if isinstance(cal, dict) else None
    if not dates:
        return None
    if not isinstance(dates, (list, tuple)):
        dates = [dates]
    ds = []
    for d in dates:
        if isinstance(d, datetime):
            ds.append(d.date())
        elif isinstance(d, date):
            ds.append(d)
        elif isinstance(d, pd.Timestamp):
            ds.append(d.date())
    if not ds:
        return None
    is_est = bool(cal.get("Is Earnings Date Estimate", len(ds) > 1)) if isinstance(cal, dict) else len(ds) > 1
    return EarningsInfo(symbol=symbol, date=min(ds), is_estimate=is_est, source="yfinance")


def info(symbol: str) -> dict:
    import yfinance as yf

    _throttle()
    try:
        i = yf.Ticker(symbol).info or {}
    except Exception as e:  # noqa: BLE001
        log.debug("yf info %s failed: %s", symbol, e)
        return {}
    return {
        "sector": i.get("sector"),
        "industry": i.get("industry"),
        "market_cap": i.get("marketCap"),
        "float_shares": i.get("floatShares"),
        "shares_outstanding": i.get("sharesOutstanding"),
        "summary": (i.get("longBusinessSummary") or "")[:600],
    }


def pct_change_today(symbol: str) -> float | None:
    """Futures (ES=F, NQ=F): last price vs previous settle, in %."""
    import yfinance as yf

    _throttle()
    try:
        h = yf.Ticker(symbol).history(period="5d", interval="1d")
    except Exception as e:  # noqa: BLE001
        log.debug("yf history %s failed: %s", symbol, e)
        return None
    if h is None or len(h) < 2:
        return None
    last, prev = float(h["Close"].iloc[-1]), float(h["Close"].iloc[-2])
    return (last / prev - 1.0) * 100.0 if prev else None


def daily_bars(symbols: list[str], start: date, end: date | None = None) -> dict[str, pd.DataFrame]:
    """Fallback bulk daily bars. Slow and 429-prone; chunked 50 symbols per call."""
    import yfinance as yf

    out: dict[str, pd.DataFrame] = {}
    for i in range(0, len(symbols), 50):
        chunk = symbols[i : i + 50]
        _throttle(2.0)
        try:
            df = yf.download(
                chunk, start=start.isoformat(), end=(end.isoformat() if end else None), group_by="ticker",
                auto_adjust=False, threads=False, progress=False,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("yf download chunk failed: %s", e)
            continue
        for sym in chunk:
            try:
                g = df[sym] if isinstance(df.columns, pd.MultiIndex) else df
            except KeyError:
                continue
            g = g.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]].dropna(subset=["close"])
            if not g.empty:
                g.index = pd.to_datetime(g.index).tz_localize(None)
                g["vwap"] = (g["high"] + g["low"] + g["close"]) / 3
                out[sym] = g
    return out


def intraday_bars(symbols: list[str], minutes: int, days: int) -> dict[str, pd.DataFrame]:
    import yfinance as yf

    out: dict[str, pd.DataFrame] = {}
    for sym in symbols:
        _throttle()
        try:
            g = yf.Ticker(sym).history(period=f"{days}d", interval=f"{minutes}m", prepost=False)
        except Exception as e:  # noqa: BLE001
            log.debug("yf intraday %s failed: %s", sym, e)
            continue
        if g is None or g.empty:
            continue
        g = g.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]]
        g.index = pd.to_datetime(g.index).tz_convert("America/New_York")
        g["vwap"] = (g["high"] + g["low"] + g["close"]) / 3
        out[sym] = g
    return out
