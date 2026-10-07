"""PatternAgent: doc Step B-D. Weekly pass (clear sky) -> 8-point trend score (>=6) -> pattern + quality score."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import pandas as pd

from swing.config import Cfg, load_config
from swing.models import PatternResult, ScreenRow, TrendScore, WeeklyCheck
from swing.patterns import detect_pattern, overhead_supply, quality_score, trend_score, weekly_check

log = logging.getLogger(__name__)


@dataclass
class Candidate:
    row: ScreenRow
    weekly: WeeklyCheck
    trend: TrendScore
    pattern: PatternResult
    dropped_reason: str | None = None


def analyze(row: ScreenRow, df: pd.DataFrame, cfg: Cfg | None = None) -> Candidate:
    cfg = cfg or load_config()
    p = cfg.patterns
    price = float(df["close"].iloc[-1])

    # Pass 1 - Weekly (5-10 s per chart in the doc): uptrend, above rising 30w MA, near 1y high, no overhead supply
    oh = overhead_supply(df, price, p.overhead_supply)
    wk = weekly_check(df, oh)
    if not wk.passed:
        why = [k for k, v in wk.model_dump().items() if k != "overhead" and v is False]
        if not oh.clear_sky:
            why.append(f"overhead supply ({oh.note})")
        return Candidate(row, wk, trend_score(df, 20, cfg.trend_score.near_high_pct, p.pivot_window), PatternResult(), f"weekly: {', '.join(why)}")

    # Pass 2 - Daily: pattern first (so base length feeds the volume-dry-up question), then the 8-point template
    pat = detect_pattern(df, cfg)
    base_bars = pat.base_bars or 20
    ts = trend_score(df, base_bars, cfg.trend_score.near_high_pct, p.pivot_window)
    if ts.score < cfg.trend_score.min_score:
        return Candidate(row, wk, ts, pat, f"trend score {ts.score}/8 (missing {', '.join(ts.missing)})")
    if pat.name == "none":
        return Candidate(row, wk, ts, pat, "no recognizable base/pattern")
    pat = quality_score(df, pat, cfg)
    if pat.resistance and (pat.resistance / price - 1.0) * 100.0 > p.resistance_max_pct_above_price:
        return Candidate(row, wk, ts, pat, f"resistance {((pat.resistance / price) - 1) * 100:.1f}% above price (> {p.resistance_max_pct_above_price}%)")
    if ts.structural_weak:
        pat.notes.append("trend score misses structure questions (5/6/7) - weaker 6+")
    return Candidate(row, wk, ts, pat)


def run(rows: list[ScreenRow], frames: dict[str, pd.DataFrame], cfg: Cfg | None = None) -> tuple[list[Candidate], list[Candidate]]:
    cfg = cfg or load_config()
    kept, dropped = [], []
    for r in rows:
        df = frames.get(r.symbol)
        if df is None or len(df) < 200:
            continue
        c = analyze(r, df, cfg)
        (dropped if c.dropped_reason else kept).append(c)
    kept.sort(key=lambda c: (c.pattern.quality_score, c.trend.score, c.row.rs_rating or 0), reverse=True)
    log.info("patterns: %d analyzed -> %d kept, %d dropped", len(rows), len(kept), len(dropped))
    return kept, dropped
