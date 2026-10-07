"""RiskAgent: doc Step E. entry = resistance +0.5..1%, stop under structure (ATR-sanity band), shares = $risk / (entry-stop),
min 2R, earnings blackout, sector cap, portfolio heat.
"""

from __future__ import annotations

import logging
import math
from collections import Counter

from swing.agents.pattern import Candidate
from swing.config import Cfg, load_config
from swing.data.earnings import is_excluded
from swing.models import PlanCard, Position

log = logging.getLogger(__name__)


def _round_tick(x: float) -> float:
    return round(x + 1e-9, 2)


def build_plan(c: Candidate, cfg: Cfg | None = None) -> PlanCard:
    cfg = cfg or load_config()
    acct, rk = cfg.account, cfg.risk
    row, pat = c.row, c.pattern
    price, atr = row.close, row.atr14
    resistance = float(pat.resistance or price)
    entry = _round_tick(resistance * (1 + rk.entry_buffer_pct_min / 100.0))
    alert_level = _round_tick(resistance)

    # Stop: under the structural low with a small ATR cushion (stops clustered exactly at the low get swept)
    structural_low = float(pat.base_low or price * (1 - rk.stop_max_pct_normal / 100.0))
    stop = structural_low - 0.25 * atr
    notes: list[str] = list(pat.notes)
    atr_mult = (entry - stop) / atr if atr else float("nan")
    if atr and atr_mult < rk.atr_stop_min_mult:
        stop = entry - rk.atr_stop_min_mult * atr
        notes.append(f"stop widened to {rk.atr_stop_min_mult:.0f}x ATR (structure too tight)")
        atr_mult = rk.atr_stop_min_mult
    stop = _round_tick(stop)
    risk_ps = entry - stop
    stop_pct = risk_ps / entry * 100.0

    # Doc stop option 2: if the base-low stop is too loose, use a tested support level inside the base
    if stop_pct > rk.stop_max_pct_reduced and pat.support_low:
        alt = _round_tick(pat.support_low - 0.25 * atr)
        alt_pct = (entry - alt) / entry * 100.0
        if rk.atr_stop_min_mult * atr <= (entry - alt) and alt_pct <= rk.stop_max_pct_reduced:
            notes.append(f"stop under in-base support {pat.support_low:.2f} (base low {structural_low:.2f} would be {stop_pct:.1f}%)")
            stop, risk_ps, stop_pct = alt, entry - alt, alt_pct
            atr_mult = risk_ps / atr if atr else atr_mult

    # Sizing: fixed-fractional; 8-12% stop only with halved $ risk (doc); >12% reject
    dollar_risk = acct.size_usd * acct.risk_pct_per_trade / 100.0
    rejected = None
    if stop_pct > rk.stop_max_pct_reduced:
        rejected = f"stop {stop_pct:.1f}% > {rk.stop_max_pct_reduced:.0f}% (base too loose)"
    elif stop_pct > rk.stop_max_pct_normal:
        dollar_risk /= 2
        notes.append(f"stop {stop_pct:.1f}% in 8-12% band -> half $ risk")
    if atr and atr_mult > rk.atr_stop_max_mult and not rejected:
        if rk.atr_hard_reject:
            rejected = f"stop {atr_mult:.1f}x ATR > {rk.atr_stop_max_mult:.0f}x"
        else:
            notes.append(f"stop is {atr_mult:.1f}x ATR14 (> {rk.atr_stop_max_mult:.0f}x) - wide relative to daily range")

    frac_shares = dollar_risk / risk_ps if risk_ps > 0 else 0.0
    shares = math.floor(frac_shares) if not acct.allow_fractional else frac_shares
    notional = shares * entry
    if not rejected and shares < 1:
        if acct.allow_fractional:
            shares = frac_shares
        else:
            notes.append(f"1 share (${entry:.0f}) exceeds ${dollar_risk:.0f} risk budget -> needs fractional or skip")
            rejected = "position too small for whole shares"
    if notional > acct.size_usd * acct.max_notional_pct / 100.0 and not rejected:
        cap_shares = math.floor(acct.size_usd * acct.max_notional_pct / 100.0 / entry)
        notes.append(f"notional capped at {acct.max_notional_pct:.0f}% of account ({shares}->{cap_shares} shares)")
        shares = cap_shares
        notional = shares * entry

    target_2r = _round_tick(entry + rk.min_r_multiple * risk_ps)
    target_3r = _round_tick(entry + 3 * risk_ps)

    # Earnings blackout (doc: no new entries within 7 trading days; estimated dates widen the window)
    if is_excluded(row.earnings) and not rejected:
        rejected = f"earnings in {row.earnings.trading_days_away} trading days"

    if not c.weekly.overhead.clear_sky and not rejected:
        rejected = "overhead supply between entry and target"

    return PlanCard(
        symbol=row.symbol,
        pattern=pat.name,
        resistance=_round_tick(resistance),
        entry=entry,
        stop=stop,
        risk_per_share=_round_tick(risk_ps),
        stop_pct=round(stop_pct, 2),
        shares=int(shares) if not acct.allow_fractional else int(math.floor(shares)),
        fractional_shares=round(frac_shares, 3),
        notional=round(float(shares) * entry, 2),
        target_2r=target_2r,
        target_3r=target_3r,
        atr14=round(atr, 3),
        stop_atr_mult=round(atr_mult, 2) if atr else 0.0,
        earnings=row.earnings,
        sector=row.sector,
        rs_rating=row.rs_rating,
        trend_score=c.trend.score,
        trend_missing=c.trend.missing,
        pattern_quality=pat.quality_score,
        alert_level=alert_level,
        status="rejected" if rejected else "watch",
        rejected_reason=rejected,
        notes=notes,
    )


def apply_portfolio_rules(plans: list[PlanCard], positions: list[Position], cfg: Cfg | None = None) -> list[PlanCard]:
    """Sector cap (<=2 per sector incl. open positions) and heat warning. Plans are already sorted best-first."""
    cfg = cfg or load_config()
    acct = cfg.account
    sector_count: Counter = Counter(p.sector for p in positions if p.sector)
    open_heat = sum(p.open_risk_usd() for p in positions) / acct.size_usd * 100.0
    slots = acct.max_positions - len(positions)
    taken = 0
    for p in plans:
        if p.status != "watch":
            continue
        if p.sector and sector_count[p.sector] >= acct.max_per_sector:
            p.status, p.rejected_reason = "rejected", f"sector cap: already {sector_count[p.sector]} in {p.sector}"
            continue
        if taken >= max(slots, 0):
            p.notes.append("beyond max open positions - watch only, no new entry unless a slot frees")
        add_heat = p.risk_per_share * p.shares / acct.size_usd * 100.0
        if open_heat + add_heat > acct.heat_cap_pct:
            p.notes.append(f"would push heat to {open_heat + add_heat:.1f}% (> {acct.heat_cap_pct:.0f}% cap) - needs a stop moved to breakeven first")
        else:
            open_heat += add_heat
        sector_count[p.sector] += 1
        taken += 1
    return plans


def run(cands: list[Candidate], positions: list[Position], cfg: Cfg | None = None) -> tuple[list[PlanCard], list[PlanCard]]:
    cfg = cfg or load_config()
    plans = [build_plan(c, cfg) for c in cands]
    plans = apply_portfolio_rules(plans, positions, cfg)
    watch = [p for p in plans if p.status == "watch"]
    rejected = [p for p in plans if p.status == "rejected"]
    log.info("risk: %d plans -> %d watch, %d rejected", len(plans), len(watch), len(rejected))
    return watch, rejected
