from datetime import date, datetime, time

from swing.calendars import (
    ET,
    close_time_et,
    in_session_window,
    is_early_close,
    is_trading_day,
    last_completed_session,
    trading_days_between,
)


def test_known_holidays_2026():
    assert not is_trading_day(date(2026, 1, 1))  # New Year
    assert not is_trading_day(date(2026, 7, 3))  # Independence Day observed (Jul 4 is Saturday)
    assert not is_trading_day(date(2026, 11, 26))  # Thanksgiving
    assert is_trading_day(date(2026, 10, 7))


def test_early_close_days_2026():
    assert is_early_close(date(2026, 11, 27))
    assert close_time_et(date(2026, 11, 27)) == time(13, 0)
    assert is_early_close(date(2026, 12, 24))
    assert not is_early_close(date(2026, 10, 7))


def test_trading_days_between_skips_weekend():
    # Fri 2026-10-09 -> Mon 2026-10-12 is 1 session
    assert trading_days_between(date(2026, 10, 9), date(2026, 10, 12)) == 1
    assert trading_days_between(date(2026, 10, 5), date(2026, 10, 9)) == 4
    assert trading_days_between(date(2026, 10, 9), date(2026, 10, 9)) == 0


def test_last_completed_session():
    ts = datetime(2026, 10, 7, 15, 0, tzinfo=ET)  # before close -> previous session
    assert last_completed_session(ts) == date(2026, 10, 6)
    ts = datetime(2026, 10, 7, 16, 30, tzinfo=ET)
    assert last_completed_session(ts) == date(2026, 10, 7)
    ts = datetime(2026, 10, 11, 12, 0, tzinfo=ET)  # Sunday
    assert last_completed_session(ts) == date(2026, 10, 9)


def test_session_window_respects_early_close():
    ts = datetime(2026, 11, 27, 14, 0, tzinfo=ET)  # after 13:00 early close
    assert not in_session_window("10:00", "15:45", ts)
    ts = datetime(2026, 11, 27, 12, 0, tzinfo=ET)
    assert in_session_window("10:00", "15:45", ts)
