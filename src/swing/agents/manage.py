"""ManageAgent: doc section 6 (15:45-16:00). Failed breakout (close back inside base) -> exit now; at 2R -> sell half,
stop to breakeven; trail under 8 EMA, never lower; earnings <= 2 days -> decide now.
"""

from __future__ import annotations

import logging

import pandas as pd

from swing.config import Cfg, load_config
from swing.indicators import ema
from swing.models import EarningsInfo, ManageAction, Position

log = logging.getLogger(__name__)


def evaluate(pos: Position, df: pd.DataFrame, last_price: float, earnings: EarningsInfo | None, cfg: Cfg | None = None) -> ManageAction:
    cfg = cfg or load_config()
    m = cfg.manage
    r = pos.risk_per_share
    if last_price <= pos.stop:
        return ManageAction(symbol=pos.symbol, action="stop_hit", reason=f"price {last_price:.2f} <= stop {pos.stop:.2f}", price=last_price)

    res = pos.resistance or pos.entry / (1 + cfg.risk.entry_buffer_pct_min / 100.0)
    if last_price < res:
        return ManageAction(symbol=pos.symbol, action="exit_failed_breakout", reason=f"closing back inside the base ({last_price:.2f} < breakout level {res:.2f}) - exit at the close, do not wait for the stop", price=last_price)

    if earnings and earnings.trading_days_away is not None and 0 <= earnings.trading_days_away <= m.earnings_decision_days:
        return ManageAction(symbol=pos.symbol, action="earnings_decision", reason=f"earnings in {earnings.trading_days_away} trading day(s) ({earnings.date}) - close all or cut half and accept the gap; decide now", price=last_price)

    if not pos.half_sold and r > 0 and last_price >= pos.entry + m.sell_half_at_r * r:
        return ManageAction(symbol=pos.symbol, action="sell_half_2r", reason=f"at {((last_price - pos.entry) / r):.1f}R - sell half, move stop to breakeven {pos.entry:.2f}", new_stop=round(pos.entry, 2), price=last_price)

    if pos.half_sold:
        e8 = float(ema(df["close"], m.trail_ema).iloc[-1])
        new_stop = round(e8 * 0.995, 2)
        if new_stop > pos.stop:
            return ManageAction(symbol=pos.symbol, action="trail_stop_8ema", reason=f"raise stop to just under the 8 EMA ({e8:.2f})", new_stop=new_stop, price=last_price)
    return ManageAction(symbol=pos.symbol, action="hold", reason=f"{((last_price - pos.entry) / r):+.1f}R, stop {pos.stop:.2f} holds" if r > 0 else "hold", price=last_price)


def run(positions: list[Position], frames: dict[str, pd.DataFrame], prices: dict[str, float], earnings: dict[str, EarningsInfo], cfg: Cfg | None = None) -> list[ManageAction]:
    out = []
    for pos in positions:
        df = frames.get(pos.symbol)
        px = prices.get(pos.symbol) or (float(df["close"].iloc[-1]) if df is not None and not df.empty else None)
        if df is None or px is None:
            out.append(ManageAction(symbol=pos.symbol, action="hold", reason="no data this run"))
            continue
        out.append(evaluate(pos, df, px, earnings.get(pos.symbol), cfg))
    log.info("manage: %s", {a.symbol: a.action for a in out})
    return out
