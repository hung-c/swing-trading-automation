"""NYSE trading-day math (holidays, early closes) and ET clock helpers."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

import pandas as pd

ET = ZoneInfo("America/New_York")


def now_et() -> datetime:
    return datetime.now(tz=ET)


def today_et() -> date:
    return now_et().date()


@lru_cache(maxsize=4)
def _nyse():
    import pandas_market_calendars as mcal

    return mcal.get_calendar("NYSE")


@lru_cache(maxsize=16)
def schedule(start: date, end: date) -> pd.DataFrame:
    """Columns market_open / market_close as tz-aware UTC timestamps, index = session date."""
    return _nyse().schedule(start_date=start.isoformat(), end_date=end.isoformat())


def trading_days(start: date, end: date) -> list[date]:
    sched = schedule(start, end)
    return [d.date() for d in sched.index]


def is_trading_day(d: date | None = None) -> bool:
    d = d or today_et()
    return len(schedule(d, d)) == 1


def close_time_et(d: date | None = None) -> time | None:
    """Regular close in ET for the given session (13:00 on early-close days), None if closed."""
    d = d or today_et()
    sched = schedule(d, d)
    if sched.empty:
        return None
    return sched.iloc[0]["market_close"].tz_convert(ET).time()


def is_early_close(d: date | None = None) -> bool:
    t = close_time_et(d)
    return bool(t and t < time(16, 0))


def next_trading_days(n: int, start: date | None = None) -> list[date]:
    start = start or today_et()
    days = trading_days(start, start + timedelta(days=max(10, n * 3)))
    return days[:n]


def trading_days_between(start: date, end: date) -> int:
    """Number of trading sessions strictly after `start` up to and including `end`. Negative if end<start."""
    if end <= start:
        return -trading_days_between(end, start) if end < start else 0
    days = trading_days(start + timedelta(days=1), end)
    return len(days)


def prev_trading_day(d: date | None = None) -> date:
    d = d or today_et()
    days = trading_days(d - timedelta(days=10), d - timedelta(days=1))
    return days[-1]


def last_completed_session(ts: datetime | None = None) -> date:
    """Most recent session whose close is already in the past (for nightly runs = today after 16:00)."""
    ts = ts or now_et()
    d = ts.date()
    for _ in range(10):
        sched = schedule(d, d)
        if not sched.empty and sched.iloc[0]["market_close"].tz_convert(ET) <= ts:
            return d
        d -= timedelta(days=1)
    raise RuntimeError("no completed session found")


def in_session_window(start_hhmm: str, end_hhmm: str, ts: datetime | None = None) -> bool:
    ts = ts or now_et()
    if not is_trading_day(ts.date()):
        return False
    s = time.fromisoformat(start_hhmm)
    e = time.fromisoformat(end_hhmm)
    close = close_time_et(ts.date())
    if close and e > close:
        e = close
    return s <= ts.time() <= e
