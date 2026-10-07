"""ScreenerAgent: Scan A (Finviz replica) + relaxation ladder + Minervini Trend Template + RS rating + earnings exclusion.

Never relaxed (doc): price > SMA50, price > SMA200, SMA50 > SMA200.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import pandas as pd

from swing.config import Cfg, load_config
from swing.data import bars
from swing.data.earnings import is_excluded
from swing.indicators import daily_features, rs_ratings, weekly_features
from swing.models import EarningsInfo, ScreenRow

log = logging.getLogger(__name__)


@dataclass
class ScreenOutput:
    rows: list[ScreenRow]
    excluded_earnings: list[ScreenRow]
    strict_count: int
    ladder_step: int
    universe_count: int
    features: pd.DataFrame = field(repr=False, default_factory=pd.DataFrame)


def compute_features(frames: dict[str, pd.DataFrame], meta: dict[str, dict]) -> pd.DataFrame:
    rows = []
    for sym, df in frames.items():
        f = daily_features(df)
        if not f:
            continue
        m = meta.get(sym, {})
        f["symbol"] = sym
        f["market_cap"] = m.get("market_cap")
        f["sector"] = m.get("sector")
        f["industry"] = m.get("industry")
        wk = weekly_features(bars.weekly(df))
        f["stage2_weekly"] = bool(wk["above_30w"] and wk["ma30w_rising"]) if wk["above_30w"] is not None else None
        rows.append(f)
    feats = pd.DataFrame(rows).set_index("symbol")
    if feats.empty:
        return feats
    feats["rs_rating"] = rs_ratings(feats["rs_raw"].astype(float))
    return feats


def _mask(feats: pd.DataFrame, p: Cfg) -> pd.Series:
    m = (
        (feats["close"] > p.price_min)
        & (feats["market_cap"].fillna(0) >= p.market_cap_min)
        & (feats["avg_vol_63"] >= p.avg_volume_min)
        & (feats["pct_below_52w_high"] >= 0)
        & (feats["pct_below_52w_high"] <= p.pct_below_52w_high_max)
        & (feats["weekly_volatility_pct"] <= p.weekly_volatility_max)
    )
    if p.require_price_above_sma50:
        m &= feats["close"] > feats["sma50"]
    if p.require_price_above_sma200:
        m &= feats["close"] > feats["sma200"]
    if p.require_sma50_above_sma200:
        m &= feats["sma50"] > feats["sma200"]
    return m


def apply_ladder(feats: pd.DataFrame, cfg: Cfg | None = None) -> tuple[pd.Series, int, int]:
    """Return (mask, ladder_step_used, strict_count). Steps are cumulative; stop when >= target_min."""
    cfg = cfg or load_config()
    sc = cfg.screener
    params = dict(sc)
    strict = _mask(feats, Cfg(params))
    strict_count = int(strict.sum())
    mask, step = strict, 0
    if strict_count >= sc.target_min_results:
        return mask, 0, strict_count
    for i, relax in enumerate(sc.ladder, start=1):
        params.update(relax)
        mask = _mask(feats, Cfg(params))
        step = i
        log.info("ladder step %d (%s): %d results", i, relax, int(mask.sum()))
        if int(mask.sum()) >= sc.target_min_results:
            break
    return mask, step, strict_count


def trend_template(f: pd.Series, p: Cfg) -> tuple[bool, list[str]]:
    """Minervini's 8 criteria (SMA150 layer, rising SMA200, 30% above low, within 25% of high, RS >= 70)."""
    fails = []
    if not (f["close"] > f["sma200"] and (f["sma150"] is None or pd.isna(f["sma150"]) or f["close"] > f["sma150"])):
        fails.append("close<=sma150/200")
    if f["sma150"] is not None and not pd.isna(f["sma150"]) and not f["sma150"] > f["sma200"]:
        fails.append("sma150<=sma200")
    if not f["sma200_rising"]:
        fails.append("sma200 not rising")
    if f["sma150"] is not None and not pd.isna(f["sma150"]) and not (f["sma50"] > f["sma150"] and f["sma50"] > f["sma200"]):
        fails.append("sma50<=sma150/200")
    if not f["close"] > f["sma50"]:
        fails.append("close<=sma50")
    if not f["pct_above_52w_low"] >= p.extras.pct_above_52w_low_min:
        fails.append(f"<{p.extras.pct_above_52w_low_min:.0f}% above 52w low")
    if not f["pct_below_52w_high"] <= 25.0:
        fails.append(">25% below 52w high")
    rs = f.get("rs_rating")
    if rs is None or pd.isna(rs) or int(rs) < p.extras.rs_rating_min:
        fails.append(f"RS<{p.extras.rs_rating_min}")
    return (len(fails) == 0), fails


def screen(
    frames: dict[str, pd.DataFrame],
    meta: dict[str, dict],
    earnings: dict[str, EarningsInfo],
    cfg: Cfg | None = None,
) -> ScreenOutput:
    cfg = cfg or load_config()
    sc = cfg.screener
    feats = compute_features(frames, meta)
    if feats.empty:
        return ScreenOutput([], [], 0, 0, len(frames), feats)
    mask, step, strict_count = apply_ladder(feats, cfg)
    if sc.extras.rs_hard_filter:
        mask &= feats["rs_rating"].fillna(0).astype(int) >= sc.extras.rs_rating_min

    rows, excluded = [], []
    for sym, f in feats[mask].sort_values("rs_rating", ascending=False, na_position="last").iterrows():
        ok, fails = trend_template(f, sc)
        if sc.extras.trend_template_hard_filter and not ok:
            continue
        e = earnings.get(sym)
        row = ScreenRow(
            symbol=sym,
            close=f["close"],
            market_cap=f["market_cap"],
            sector=f["sector"],
            industry=f["industry"],
            avg_vol_63=f["avg_vol_63"],
            sma50=f["sma50"],
            sma150=None if pd.isna(f["sma150"]) else f["sma150"],
            sma200=f["sma200"],
            sma200_rising=bool(f["sma200_rising"]),
            high_52w=f["high_52w"],
            low_52w=f["low_52w"],
            pct_below_52w_high=f["pct_below_52w_high"],
            pct_above_52w_low=f["pct_above_52w_low"],
            weekly_volatility_pct=f["weekly_volatility_pct"],
            atr14=f["atr14"],
            adr20_pct=f["adr20_pct"],
            rs_raw=None if pd.isna(f["rs_raw"]) else f["rs_raw"],
            rs_rating=None if pd.isna(f["rs_rating"]) else int(f["rs_rating"]),
            trend_template_pass=ok,
            trend_template_fails=fails,
            stage2_weekly=None if pd.isna(f["stage2_weekly"]) else bool(f["stage2_weekly"]),
            earnings=e,
            ladder_step=step,
        )
        if is_excluded(e):
            row.excluded_reason = f"earnings in {e.trading_days_away} trading days"
            excluded.append(row)
        else:
            rows.append(row)
    log.info("screen: universe=%d strict=%d ladder_step=%d final=%d excluded_earnings=%d", len(feats), strict_count, step, len(rows), len(excluded))
    return ScreenOutput(rows, excluded, strict_count, step, len(feats), feats)


def finviz_url(cfg: Cfg | None = None) -> str:
    """The doc's Finviz URL for manual parity checks (reflects the strict config, not the ladder)."""
    cfg = cfg or load_config()
    sc = cfg.screener
    cap = "cap_midover" if sc.market_cap_min >= 2e9 else "cap_smallover"
    vol = "sh_avgvol_o1000" if sc.avg_volume_min >= 1_000_000 else "sh_avgvol_o500"
    hi = "ta_highlow52w_b0to10h" if sc.pct_below_52w_high_max <= 10 else "ta_highlow52w_b0to20h"
    vw = "ta_volatility_wo3" if sc.weekly_volatility_max <= 3 else "ta_volatility_wo5"
    return f"https://finviz.com/screener.ashx?v=111&f={cap},{vol},sh_price_o10,{hi},ta_sma200_pa,ta_sma200_sb50,ta_sma50_pa,{vw}"
