"""AlertAgent: doc section 5 "Quét B". For each plan: price crossed resistance? above yesterday's close? above VWAP?
time-adjusted RVOL > 1.5? Not more than +1% above resistance (no chasing)? Plus stop / 2R checks for open positions.

Price = latest IEX trade (real time). Volume/VWAP/RVOL = SIP 5-min bars lagged 16 minutes (free plan).
"""

from __future__ import annotations

import logging
from datetime import datetime

import pandas as pd

from swing.calendars import ET, now_et
from swing.config import Cfg, load_config
from swing.indicators import session_vwap, time_adjusted_rvol
from swing.models import Alert, PlanCard, Position, RegimeReport

log = logging.getLogger(__name__)


def _entry_allowed(regime: RegimeReport | None, ts: datetime) -> tuple[bool, str]:
    if regime is None:
        return True, ""
    hhmm = ts.strftime("%H:%M")
    if regime.sizing == "none":
        return False, "regime says NO new entries today"
    if regime.no_new_entries_before and hhmm < regime.no_new_entries_before:
        return False, f"no new entries before {regime.no_new_entries_before} (macro/futures)"
    if regime.no_new_entries_after and hhmm > regime.no_new_entries_after:
        return False, f"no new entries after {regime.no_new_entries_after} (FOMC)"
    return True, ""


def evaluate_plan(
    plan: PlanCard,
    price: float,
    yesterday_close: float | None,
    intra: pd.DataFrame | None,
    regime: RegimeReport | None,
    ts: datetime,
    cfg: Cfg | None = None,
) -> Alert | None:
    cfg = cfg or load_config()
    p = cfg.intraday
    res = plan.resistance
    vwap = rvol = None
    if intra is not None and not intra.empty:
        v = session_vwap(intra)
        today = intra[intra.index.date == ts.astimezone(ET).date()]
        if not today.empty:
            vwap = float(v.loc[today.index].iloc[-1])
        rvol = time_adjusted_rvol(intra, pd.Timestamp(ts), p.rvol_baseline_sessions)
    above_yc = (price > yesterday_close) if yesterday_close else None

    base = dict(ts=ts, symbol=plan.symbol, price=price, resistance=res, vwap=vwap, rvol=rvol, above_yesterday_close=above_yc)
    chase_level = res * (1 + p.no_chase_pct_above_resistance / 100.0)

    if price >= chase_level:
        return Alert(**base, condition="extended", actionable=False, message=f"{plan.symbol} {price:.2f} is >{p.no_chase_pct_above_resistance:.0f}% above resistance {res:.2f} - do NOT chase; wait for next week's setup.")
    if price > res:
        checks = {
            "above yesterday close": bool(above_yc) if above_yc is not None else None,
            "above VWAP": (price > vwap) if vwap else None,
            f"RVOL>{p.rvol_min}": (rvol >= p.rvol_min) if rvol is not None else None,
        }
        missing = [k for k, v in checks.items() if v is False]
        unknown = [k for k, v in checks.items() if v is None]
        allowed, why = _entry_allowed(regime, ts)
        if not missing and allowed:
            grade = "EXCELLENT" if rvol and rvol >= p.rvol_excellent else "good"
            return Alert(
                **base,
                condition="breakout_confirmed",
                actionable=True,
                message=(
                    f"BUY SIGNAL {plan.symbol}: {price:.2f} > resistance {res:.2f}. RVOL {rvol:.2f} ({grade}), VWAP {vwap:.2f}, "
                    f"yday close {yesterday_close:.2f}. Plan: limit {plan.entry:.2f} (max {chase_level:.2f}), stop {plan.stop:.2f}, "
                    f"{plan.shares} shares, 2R {plan.target_2r:.2f}. Place the stop in the same minute."
                    + (f" Unverified: {', '.join(unknown)}." if unknown else "")
                ),
            )
        reason = why or ("missing " + ", ".join(missing))
        return Alert(**base, condition="breakout_unconfirmed", actionable=False, message=f"{plan.symbol} {price:.2f} above resistance {res:.2f} but {reason}. Wait.")
    if price >= res * 0.99:
        return Alert(**base, condition="approaching", actionable=False, message=f"{plan.symbol} {price:.2f} within 1% of resistance {res:.2f}. Watch the 15-min chart.")
    return None


def evaluate_position(pos: Position, price: float, ts: datetime) -> Alert | None:
    if price <= pos.stop:
        return Alert(ts=ts, symbol=pos.symbol, price=price, condition="stop_hit", actionable=True, message=f"{pos.symbol} {price:.2f} <= stop {pos.stop:.2f}. Your stop order should have filled - verify.")
    if not pos.half_sold and price >= pos.target_2r:
        return Alert(ts=ts, symbol=pos.symbol, price=price, condition="target_2r", actionable=True, message=f"{pos.symbol} {price:.2f} >= 2R target {pos.target_2r:.2f}: sell half, move stop to breakeven {pos.entry:.2f}.")
    return None


def run(
    plans: list[PlanCard],
    positions: list[Position],
    prices: dict[str, float],
    yesterday_close: dict[str, float],
    intraday: dict[str, pd.DataFrame],
    regime: RegimeReport | None,
    ts: datetime | None = None,
    cfg: Cfg | None = None,
) -> list[Alert]:
    ts = ts or now_et()
    out: list[Alert] = []
    for plan in plans:
        px = prices.get(plan.symbol)
        if px is None:
            continue
        a = evaluate_plan(plan, px, yesterday_close.get(plan.symbol), intraday.get(plan.symbol), regime, ts, cfg)
        if a:
            out.append(a)
    for pos in positions:
        px = prices.get(pos.symbol)
        if px is None:
            continue
        a = evaluate_position(pos, px, ts)
        if a:
            out.append(a)
    log.info("alerts: %d (%d actionable)", len(out), sum(a.actionable for a in out))
    return out
