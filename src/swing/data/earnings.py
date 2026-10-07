"""Earnings dates with cross-checking.

Primary Finnhub (whole market, bmo/amc). yfinance adds the only free confirmed/estimate flag; if estimated,
the exclusion window is widened by cfg.screener.earnings_estimate_pad_days. Alpha Vantage is a cheap
disagreement detector (1 call/day).
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

from swing.calendars import trading_days_between
from swing.config import load_config
from swing.data import alphavantage, finnhub, yf
from swing.models import EarningsInfo

log = logging.getLogger(__name__)


def upcoming(symbols: list[str], today: date, horizon_days: int = 45, confirm_with_yf: bool = True) -> dict[str, EarningsInfo]:
    cfg = load_config().screener
    window_end = today + timedelta(days=horizon_days)
    fh = finnhub.earnings_calendar(today, window_end)
    av = alphavantage.earnings_calendar("3month") if alphavantage.available() else {}

    out: dict[str, EarningsInfo] = {}
    for sym in symbols:
        info = fh.get(sym) or av.get(sym)
        if info is None:
            continue
        info = info.model_copy()
        if av.get(sym) and info.date and av[sym].date and abs((av[sym].date - info.date).days) > 1:
            info.is_estimate = True  # sources disagree -> treat as unconfirmed
        out[sym] = info

    # yfinance confirmation only for names inside the danger window (cheap, ~5-15 names)
    if confirm_with_yf:
        danger = cfg.earnings_exclude_trading_days + cfg.earnings_estimate_pad_days + 3
        for sym, info in list(out.items()):
            if info.date and 0 <= trading_days_between(today, info.date) <= danger:
                y = yf.earnings(sym)
                if y and y.date:
                    if abs((y.date - info.date).days) > 1:
                        info.is_estimate = True
                        info.date = min(info.date, y.date)
                    elif not y.is_estimate:
                        info.is_estimate = False
                    else:
                        info.is_estimate = True

    for info in out.values():
        info.trading_days_away = trading_days_between(today, info.date) if info.date else None
    return out


def exclude_days(info: EarningsInfo | None) -> int:
    """How many trading days ahead this symbol must be excluded, given estimate padding."""
    cfg = load_config().screener
    if info is None or info.date is None:
        return 0
    base = cfg.earnings_exclude_trading_days
    return base + (cfg.earnings_estimate_pad_days if info.is_estimate else 0)


def is_excluded(info: EarningsInfo | None) -> bool:
    if info is None or info.trading_days_away is None:
        return False
    # negative = already reported; exclude only if within [0, N]
    return 0 <= info.trading_days_away <= exclude_days(info)
