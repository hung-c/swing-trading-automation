"""RegimeAgent: doc section 3 (SPY/QQQ vs MA50/MA200 sizing table, futures, macro news) plus research add-ons:
IBD distribution-day count / follow-through day, breadth from our own universe, Faber 10-month SMA switch.
"""

from __future__ import annotations

import logging
from datetime import date

import pandas as pd

from swing.config import Cfg, load_config
from swing.data import bars, macro, yf
from swing.indicators import rising, sma
from swing.models import DistributionState, MacroEvent, RegimeReport

log = logging.getLogger(__name__)


# ---------- IBD distribution days / follow-through ----------
def distribution_state(df: pd.DataFrame, symbol: str, p: Cfg) -> DistributionState:
    """Distribution day: close <= -0.2% on higher volume than the prior day. Rolling 25 sessions; a day expires
    after 25 sessions or once the index closes >= 5% above that day's close. Rally attempt / FTD per IBD."""
    d = df.iloc[-(p.distribution_window_sessions + 30) :].copy()
    ret = d["close"].pct_change() * 100.0
    vol_up = d["volume"] > d["volume"].shift(1)
    is_dist = (ret <= p.distribution_day_drop_pct) & vol_up
    window = d.iloc[-p.distribution_window_sessions :]
    last_close = float(d["close"].iloc[-1])
    days = []
    for ts in window.index[is_dist.loc[window.index]]:
        if last_close < float(d.loc[ts, "close"]) * (1 + p.distribution_expire_rally_pct / 100.0):
            days.append(ts.date())
    count = len(days)

    # rally attempt: days since the lowest close in the last 60 bars; FTD = day >= 4 with gain >= 1.25% on higher volume
    recent = df.iloc[-60:]
    low_i = int(recent["close"].to_numpy().argmin())
    rally_day = len(recent) - 1 - low_i if low_i < len(recent) - 1 else None
    ftd = False
    if rally_day and rally_day >= 4:
        seg = recent.iloc[low_i + 1 :]
        g = seg["close"].pct_change() * 100.0
        for k in range(3, len(seg)):  # day 4+ of the attempt (index 3 => day 4)
            if g.iloc[k] >= p.ftd_min_gain_pct and seg["volume"].iloc[k] > seg["volume"].iloc[k - 1]:
                ftd = True
                break
    pct_off_high = (1 - last_close / float(df["high"].iloc[-120:].max())) * 100.0
    # IBD/research: heavy distribution only becomes a "correction" call once the index is actually off its highs
    if (count >= p.distribution_correction_count and pct_off_high >= p.distribution_correction_min_off_high_pct) or (
        count >= p.distribution_pressure_count and pct_off_high >= 6.0
    ):
        status = "correction"
    elif count >= p.distribution_pressure_count:
        status = "under_pressure"
    else:
        status = "confirmed_uptrend"
    return DistributionState(symbol=symbol, distribution_days=count, days=days, rally_day=rally_day, follow_through=ftd, status=status)


# ---------- breadth from the universe we already downloaded ----------
def breadth(frames: dict[str, pd.DataFrame]) -> dict:
    above50 = above200 = total = nh = nl = 0
    for df in frames.values():
        if len(df) < 200:
            continue
        c = df["close"]
        total += 1
        above50 += int(c.iloc[-1] > sma(c, 50).iloc[-1])
        above200 += int(c.iloc[-1] > sma(c, 200).iloc[-1])
        hi, lo = df["high"].iloc[-252:].max(), df["low"].iloc[-252:].min()
        nh += int(df["high"].iloc[-1] >= hi)
        nl += int(df["low"].iloc[-1] <= lo)
    if not total:
        return {}
    return {"pct_above_50": above50 / total * 100.0, "pct_above_200": above200 / total * 100.0, "new_highs": nh, "new_lows": nl, "n": total}


def faber_risk_on(df: pd.DataFrame, months: int = 10) -> bool | None:
    m = df["close"].resample("ME").last().dropna()
    if len(m) < months + 1:
        return None
    return bool(m.iloc[-1] > m.iloc[-months:].mean())


def sizing_from_table(spy_50: bool, qqq_50: bool, spy_200: bool, qqq_200: bool, p: Cfg) -> tuple[str, int | None, str]:
    t = p.sizing_table
    if not (spy_200 and qqq_200):
        r = t.one_below_200
        return r["size"], r["max_new"], "one index below MA200 -> stand aside, keep scanning"
    if spy_50 and qqq_50:
        r = t.both_above_50
        return r["size"], r["max_new"], "both indices above MA50"
    if spy_50 or qqq_50:
        r = t.one_above_50
        return r["size"], r["max_new"], "one index above MA50, one below -> half size, max 2 new"
    r = t.both_below_50
    return r["size"], r["max_new"], "both indices below MA50 -> no new entries, manage only"


def run(as_of: date, universe_frames: dict[str, pd.DataFrame] | None = None, cfg: Cfg | None = None) -> RegimeReport:
    cfg = cfg or load_config()
    p = cfg.regime
    spy_sym, qqq_sym = p.index_symbols.spx, p.index_symbols.ndx
    idx, _prov = bars.daily([spy_sym, qqq_sym], years=2.0, end=as_of)
    rep = RegimeReport(as_of=as_of)
    spy, qqq = idx.get(spy_sym), idx.get(qqq_sym)
    if spy is None or qqq is None or len(spy) < 200 or len(qqq) < 200:
        rep.notes.append("index bars unavailable - regime unknown, default to HALF size")
        rep.sizing, rep.max_new_positions = "half", 2
        return rep

    def ma_flags(df: pd.DataFrame):
        c = df["close"]
        return float(c.iloc[-1]), bool(c.iloc[-1] > sma(c, 50).iloc[-1]), bool(c.iloc[-1] > sma(c, 200).iloc[-1]), rising(sma(c, 50), 10)

    rep.spy_close, rep.spy_above_50, rep.spy_above_200, rep.spy_ma50_rising = ma_flags(spy)
    rep.qqq_close, rep.qqq_above_50, rep.qqq_above_200, rep.qqq_ma50_rising = ma_flags(qqq)
    rep.sizing, rep.max_new_positions, why = sizing_from_table(rep.spy_above_50, rep.qqq_above_50, rep.spy_above_200, rep.qqq_above_200, p)
    rep.notes.append(why)

    # futures (yfinance, personal monitoring only)
    rep.es_pct = yf.pct_change_today(p.futures_symbols.es)
    rep.nq_pct = yf.pct_change_today(p.futures_symbols.nq)
    worst = min([x for x in (rep.es_pct, rep.nq_pct) if x is not None], default=None)
    rep.futures_red = (worst is not None and worst <= p.futures_red_threshold_pct)
    if rep.futures_red:
        rep.notes.append(f"futures {worst:+.2f}% <= {p.futures_red_threshold_pct}% -> no new entries before 10:30")
        rep.no_new_entries_before = "10:30"

    # distribution days / FTD
    rep.distribution = [distribution_state(spy, spy_sym, p), distribution_state(qqq, qqq_sym, p)]
    worst_status = max((d.status for d in rep.distribution), key=["confirmed_uptrend", "under_pressure", "correction"].index)
    if worst_status == "correction" and rep.sizing != "none":
        rep.sizing, rep.max_new_positions = "none", 0
        rep.notes.append("distribution-day count says CORRECTION -> no new entries until a follow-through day")
    elif worst_status == "under_pressure" and rep.sizing == "full":
        rep.sizing, rep.max_new_positions = "half", 2
        rep.notes.append("market under pressure (>=5 distribution days) -> half size")
    if any(d.follow_through for d in rep.distribution) and worst_status == "correction":
        rep.notes.append("follow-through day detected inside the correction - size up gradually, not all at once")

    # breadth (only if the nightly job passed us its frames)
    if universe_frames:
        b = breadth(universe_frames)
        if b:
            rep.breadth_pct_above_50, rep.breadth_pct_above_200 = b["pct_above_50"], b["pct_above_200"]
            rep.new_highs, rep.new_lows = b["new_highs"], b["new_lows"]
            if b["pct_above_200"] < p.breadth_risk_off_pct and rep.sizing == "full":
                rep.sizing, rep.max_new_positions = "half", 2
                rep.notes.append(f"breadth weak: {b['pct_above_200']:.0f}% of universe above MA200 (< {p.breadth_risk_off_pct:.0f}%)")

    # Faber 10-month SMA outer switch
    rep.faber_risk_on = faber_risk_on(spy, p.faber_months)
    if rep.faber_risk_on is False:
        rep.sizing, rep.max_new_positions = "none", 0
        rep.notes.append("SPY below its 10-month SMA (Faber) -> risk-off, no new entries")

    # macro blackout
    today_ev, week_ev = macro.events_today_and_week(as_of)
    rep.macro_today, rep.macro_week = today_ev, week_ev
    _apply_macro(rep, today_ev)
    return rep


def _apply_macro(rep: RegimeReport, today_ev: list[MacroEvent]) -> None:
    for e in today_ev:
        if e.no_new_entries_before:
            rep.no_new_entries_before = max(rep.no_new_entries_before or "00:00", e.no_new_entries_before)
            rep.notes.append(f"{e.name} at {e.time_et} ET -> no new entries before {e.no_new_entries_before}")
        if e.no_new_entries_after:
            rep.no_new_entries_after = min(rep.no_new_entries_after or "23:59", e.no_new_entries_after)
            rep.notes.append(f"{e.name} at {e.time_et} ET -> no new entries after {e.no_new_entries_after}")
