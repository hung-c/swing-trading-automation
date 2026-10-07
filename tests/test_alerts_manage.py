from datetime import date, datetime

import numpy as np
import pandas as pd
from conftest import make_bars

from swing.agents import alerts, manage
from swing.calendars import ET
from swing.indicators import session_vwap, time_adjusted_rvol
from swing.models import EarningsInfo, PlanCard, Position, RegimeReport


def _intra(days=21, bars_per_day=78, vol=10_000, today_mult=2.0, price=100.0):
    """5-min bars for `days` sessions ending today (2026-10-07), U-shaped volume; today's volume x today_mult."""
    rows = []
    sessions = pd.bdate_range(end="2026-10-07", periods=days)
    for d in sessions:
        for k in range(bars_per_day):
            t = pd.Timestamp(d.date()) + pd.Timedelta(hours=9, minutes=30 + 5 * k)
            u = 1 + 2 * ((k / bars_per_day - 0.5) ** 2) * 4  # heavier at open/close
            v = vol * u * (today_mult if d == sessions[-1] else 1.0)
            rows.append((t.tz_localize(ET), price, price + 0.2, price - 0.2, price, v))
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"]).set_index("ts")
    return df


def test_time_adjusted_rvol_detects_double_volume():
    intra = _intra(today_mult=2.0)
    now = pd.Timestamp("2026-10-07 11:30", tz=ET)
    r = time_adjusted_rvol(intra, now, 20)
    assert abs(r - 2.0) < 0.05


def test_session_vwap_resets_daily():
    intra = _intra(days=2)
    v = session_vwap(intra)
    assert len(v) == len(intra)
    assert np.isclose(v.iloc[0], intra["close"].iloc[0], atol=0.2)


def _plan(symbol="ABC", res=100.0):
    return PlanCard(
        symbol=symbol, pattern="flat_base", resistance=res, entry=res * 1.005, stop=res * 0.94, risk_per_share=res * 0.065,
        stop_pct=6.5, shares=7, fractional_shares=7.4, notional=700, target_2r=res * 1.135, target_3r=res * 1.2, atr14=2.0,
        stop_atr_mult=3.0, trend_score=7, pattern_quality=7.5, alert_level=res,
    )


def test_breakout_confirmed(cfg):
    intra = _intra(today_mult=2.0)
    ts = datetime(2026, 10, 7, 11, 30, tzinfo=ET)
    a = alerts.evaluate_plan(_plan(), 100.6, 99.0, intra, RegimeReport(as_of=date(2026, 10, 7), sizing="full"), ts, cfg)
    assert a and a.condition == "breakout_confirmed" and a.actionable
    assert "BUY SIGNAL" in a.message and a.rvol and a.rvol > 1.5


def test_breakout_blocked_by_regime_and_macro(cfg):
    intra = _intra(today_mult=2.0)
    ts = datetime(2026, 10, 7, 9, 45, tzinfo=ET)
    reg = RegimeReport(as_of=date(2026, 10, 7), sizing="full", no_new_entries_before="10:00")
    a = alerts.evaluate_plan(_plan(), 100.6, 99.0, intra, reg, ts, cfg)
    assert a.condition == "breakout_unconfirmed" and not a.actionable and "before 10:00" in a.message
    reg = RegimeReport(as_of=date(2026, 10, 7), sizing="none")
    a = alerts.evaluate_plan(_plan(), 100.6, 99.0, intra, reg, datetime(2026, 10, 7, 11, 0, tzinfo=ET), cfg)
    assert not a.actionable and "NO new entries" in a.message


def test_breakout_unconfirmed_low_rvol(cfg):
    intra = _intra(today_mult=0.8)
    ts = datetime(2026, 10, 7, 11, 30, tzinfo=ET)
    a = alerts.evaluate_plan(_plan(), 100.6, 99.0, intra, None, ts, cfg)
    assert a.condition == "breakout_unconfirmed" and "RVOL" in a.message


def test_extended_and_approaching(cfg):
    ts = datetime(2026, 10, 7, 11, 30, tzinfo=ET)
    a = alerts.evaluate_plan(_plan(), 101.5, 99.0, None, None, ts, cfg)
    assert a.condition == "extended" and "NOT chase" in a.message
    a = alerts.evaluate_plan(_plan(), 99.5, 99.0, None, None, ts, cfg)
    assert a.condition == "approaching"
    assert alerts.evaluate_plan(_plan(), 95.0, 99.0, None, None, ts, cfg) is None


def test_position_alerts():
    ts = datetime(2026, 10, 7, 11, 30, tzinfo=ET)
    pos = Position(symbol="X", opened=date(2026, 10, 1), entry=100, stop=94, initial_stop=94, shares=10, target_2r=112)
    assert alerts.evaluate_position(pos, 93.5, ts).condition == "stop_hit"
    assert alerts.evaluate_position(pos, 112.5, ts).condition == "target_2r"
    assert alerts.evaluate_position(pos, 105, ts) is None


def test_manage_rules(cfg):
    df = make_bars([(250, 40.0, 1.5)], start_price=70.0)
    last = float(df["close"].iloc[-1])
    pos = Position(symbol="X", opened=date(2026, 10, 1), entry=last * 0.9, stop=last * 0.84, initial_stop=last * 0.84, shares=10, target_2r=last * 1.02, resistance=last * 0.895)
    # at +1.6R, not yet 2R -> hold
    assert manage.evaluate(pos, df, last, None, cfg).action == "hold"
    # price at >= 2R -> sell half
    assert manage.evaluate(pos, df, last * 1.03, None, cfg).action == "sell_half_2r"
    # half sold -> trail under 8 EMA, only upward
    pos.half_sold, pos.stop = True, pos.entry
    act = manage.evaluate(pos, df, last * 1.03, None, cfg)
    assert act.action == "trail_stop_8ema" and act.new_stop > pos.stop
    # close back below the breakout level (stop still at initial level) -> exit at the close
    pos.half_sold, pos.stop = False, pos.initial_stop
    assert manage.evaluate(pos, df, pos.resistance * 0.99, None, cfg).action == "exit_failed_breakout"
    # stop hit dominates
    assert manage.evaluate(pos, df, pos.stop * 0.99, None, cfg).action == "stop_hit"
    # earnings in 2 days -> decision
    e = EarningsInfo(symbol="X", date=date(2026, 10, 9), trading_days_away=2)
    pos.half_sold = False
    pos.stop = pos.initial_stop
    assert manage.evaluate(pos, df, last, e, cfg).action == "earnings_decision"
