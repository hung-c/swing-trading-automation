"""Optional parity check: express Scan A server-side with the unofficial `tradingview-screener` package and diff it
against our locally computed list. Not a source of truth (undocumented API, ToS-grey, 429-prone) - a bug detector.

    uv sync --extra extras && uv run swing parity
"""

from __future__ import annotations

import logging

from swing.config import load_config

log = logging.getLogger(__name__)


def tradingview_scan_a(limit: int = 500) -> set[str]:
    try:
        from tradingview_screener import Column, Query
    except ImportError as e:
        raise SystemExit("pip install tradingview-screener (uv sync --extra extras)") from e
    sc = load_config().screener
    q = (
        Query()
        .select("name", "close", "market_cap_basic", "average_volume_90d_calc", "SMA50", "SMA200", "price_52_week_high", "Volatility.W")
        .where(
            Column("close") > sc.price_min,
            Column("market_cap_basic") > sc.market_cap_min,
            Column("average_volume_90d_calc") > sc.avg_volume_min,
            Column("close") > Column("SMA50"),
            Column("close") > Column("SMA200"),
            Column("SMA50") > Column("SMA200"),
            Column("close").above_pct("price_52_week_high", 1 - sc.pct_below_52w_high_max / 100.0),
            Column("Volatility.W") < sc.weekly_volatility_max,
            Column("exchange").isin(["NASDAQ", "NYSE", "AMEX"]),
            Column("typespecs").has(["common"]),
        )
        .limit(limit)
    )
    _, df = q.get_scanner_data()
    return set(df["name"].astype(str))


def cmd_parity(_args) -> int:
    from swing import journal

    tv = tradingview_scan_a()
    d = journal.latest_plan_date()
    ours = {p.symbol for p in journal.plans_for(d)} if d else set()
    print(f"tradingview Scan A: {len(tv)} | our latest plan universe (post-pattern): {len(ours)}")
    print("in TV but not in our plans (expected: most, patterns filter further):", sorted(tv - ours)[:60])
    print("in our plans but not in TV (investigate - filter mismatch?):", sorted(ours - tv))
    return 0
