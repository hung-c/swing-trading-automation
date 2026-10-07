from datetime import date

import numpy as np
import pandas as pd
from conftest import make_bars

from swing.agents.regime import _apply_macro, breadth, distribution_state, faber_risk_on, sizing_from_table
from swing.models import MacroEvent, RegimeReport


def test_sizing_table(cfg):
    p = cfg.regime
    assert sizing_from_table(True, True, True, True, p)[0] == "full"
    assert sizing_from_table(True, False, True, True, p)[:2] == ("half", 2)
    assert sizing_from_table(False, False, True, True, p)[:2] == ("none", 0)
    assert sizing_from_table(True, True, False, True, p)[:2] == ("none", 0)


def test_distribution_days_counted_and_expired(cfg):
    p = cfg.regime
    df = make_bars([(120, 5.0, 1.0)], start_price=100.0, seed=3)
    # inject 6 distribution days in the last 25 sessions: drop 0.5% on higher volume
    for k in range(2, 26, 4):
        i = len(df) - k
        df.iloc[i, df.columns.get_loc("close")] = df["close"].iloc[i - 1] * 0.994
        df.iloc[i, df.columns.get_loc("volume")] = df["volume"].iloc[i - 1] * 1.5
    st = distribution_state(df, "SPY", p)
    assert st.distribution_days >= 5
    assert st.status in ("under_pressure", "correction")
    # a 6% rally above those closes expires them
    df2 = df.copy()
    df2.iloc[-1, df2.columns.get_loc("close")] = df["close"].max() * 1.06
    st2 = distribution_state(df2, "SPY", p)
    assert st2.distribution_days == 0 and st2.status == "confirmed_uptrend"


def test_follow_through_day(cfg):
    p = cfg.regime
    df = make_bars([(100, 10.0, 1.0), (15, -8.0, 1.5), (6, 1.0, 1.0)], start_price=100.0, seed=5)
    # day 5 after the low: +1.5% on higher volume
    i = len(df) - 2
    df.iloc[i, df.columns.get_loc("close")] = df["close"].iloc[i - 1] * 1.015
    df.iloc[i, df.columns.get_loc("volume")] = df["volume"].iloc[i - 1] * 1.4
    st = distribution_state(df, "QQQ", p)
    assert st.rally_day is not None and st.rally_day >= 4
    assert st.follow_through


def test_breadth():
    up = make_bars([(260, 40.0, 1.5)], seed=1)
    down = make_bars([(260, -40.0, 1.5)], seed=2)
    b = breadth({"A": up, "B": down, "C": up})
    assert b["n"] == 3
    assert abs(b["pct_above_200"] - 66.67) < 0.1
    assert b["new_highs"] >= 0 and b["new_lows"] >= 0


def test_faber():
    up = make_bars([(300, 30.0, 1.0)], start="2024-01-02", seed=1)
    assert faber_risk_on(up) is True
    down = make_bars([(300, -30.0, 1.0)], start="2024-01-02", seed=1)
    assert faber_risk_on(down) is False
    short = make_bars([(40, 1.0, 1.0)])
    assert faber_risk_on(short) is None


def test_macro_rules_applied_to_report():
    rep = RegimeReport(as_of=date(2026, 10, 28))
    ev = [
        MacroEvent(name="CPI", date=date(2026, 10, 28), time_et="08:30", no_new_entries_before="10:00"),
        MacroEvent(name="FOMC decision", date=date(2026, 10, 28), time_et="14:00", no_new_entries_after="13:30"),
    ]
    _apply_macro(rep, ev)
    assert rep.no_new_entries_before == "10:00" and rep.no_new_entries_after == "13:30"
    assert len(rep.notes) == 2


def test_nan_safe_breadth():
    df = make_bars([(260, 10.0, 1.0)])
    df.iloc[-1, df.columns.get_loc("close")] = np.nan
    b = breadth({"A": df.dropna()})
    assert b["n"] == 1
    assert isinstance(pd.Timestamp(df.index[-1]), pd.Timestamp)
