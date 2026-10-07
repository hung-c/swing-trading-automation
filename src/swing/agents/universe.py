"""UniverseAgent: cleaned US common-stock universe with market cap / sector, cheaply prefiltered for the bar download."""

from __future__ import annotations

import logging

import pandas as pd

from swing.config import load_config
from swing.data import nasdaq

log = logging.getLogger(__name__)


def build(limit: int | None = None) -> pd.DataFrame:
    """Return a DataFrame [symbol, name, exchange, market_cap, sector, industry, last].

    Prefilter uses the loosest ladder values (so the ladder can still relax later) to keep the bar download small.
    """
    cfg = load_config()
    sc = cfg.screener
    loosest_cap = min([sc.market_cap_min] + [s.get("market_cap_min", sc.market_cap_min) for s in sc.ladder])
    df = nasdaq.universe(prefilter_cap=loosest_cap * 0.8, prefilter_price=sc.price_min * 0.8)
    df = df.sort_values("market_cap", ascending=False, na_position="last")
    cap = limit or cfg.universe.max_tickers_for_bars
    if len(df) > cap:
        log.info("universe capped from %d to %d by market cap", len(df), cap)
        df = df.head(cap)
    return df.reset_index(drop=True)


def meta_by_symbol(df: pd.DataFrame) -> dict[str, dict]:
    return {
        r.symbol: {
            "name": r.name,
            "exchange": r.exchange,
            "market_cap": None if pd.isna(r.market_cap) else float(r.market_cap),
            "sector": None if pd.isna(r.sector) else r.sector,
            "industry": None if pd.isna(r.industry) else r.industry,
        }
        for r in df.itertuples(index=False)
    }
