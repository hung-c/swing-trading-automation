"""Pattern geometry on daily bars (doc Step B-D): swing pivots, base detection, four named patterns,
VCP contraction check, overhead-supply (volume-at-price), base count, 8-point trend score, weekly check.

Pivots are confirmed only `n` bars later (no look-ahead). All lengths are in trading bars (5 per week).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from swing.config import Cfg, load_config
from swing.indicators import bb_width_at_low, ema, sma, volume_drying
from swing.models import OverheadSupply, PatternResult, TrendScore, WeeklyCheck


# ---------- pivots ----------
def swing_pivots(df: pd.DataFrame, n: int = 3) -> tuple[list[tuple[int, float]], list[tuple[int, float]]]:
    """Confirmed swing highs/lows: bar i is a pivot high if high[i] == max(high[i-n..i+n]). Returns (pos, price)."""
    h, lo = df["high"].to_numpy(), df["low"].to_numpy()
    highs, lows = [], []
    for i in range(n, len(df) - n):
        win_h = h[i - n : i + n + 1]
        win_l = lo[i - n : i + n + 1]
        if h[i] >= win_h.max() and np.argmax(win_h) == n:
            highs.append((i, float(h[i])))
        if lo[i] <= win_l.min() and np.argmin(win_l) == n:
            lows.append((i, float(lo[i])))
    return highs, lows


# ---------- base detection ----------
@dataclass
class Base:
    start: int  # positional index of first base bar
    bars: int
    high: float
    low: float
    depth_pct: float
    resistance: float  # drawn through high closes, not a single wick
    prior_run_pct: float | None


def find_base(df: pd.DataFrame, min_bars: int, max_bars: int, depth_max_pct: float) -> Base | None:
    """Longest trailing window within [min_bars, max_bars] whose high-low depth <= depth_max. None if none qualifies."""
    best: Base | None = None
    n = len(df)
    for L in range(min_bars, min(max_bars, n - 1) + 1):
        seg = df.iloc[n - L :]
        hi, lo = float(seg["high"].max()), float(seg["low"].min())
        depth = (hi - lo) / hi * 100.0
        if depth <= depth_max_pct:
            closes = seg["close"].sort_values(ascending=False)
            resistance = float(closes.iloc[: max(1, min(3, len(closes) // 10))].mean())  # avg of top closes
            resistance = max(resistance, float(seg["close"].max()) * 0.995)
            best = Base(n - L, L, hi, lo, depth, resistance, None)
    if best is None:
        return None
    pre = df.iloc[max(0, best.start - 250) : best.start]
    if len(pre) >= 40:
        best.prior_run_pct = (best.high / float(pre["close"].iloc[-60:].min() if len(pre) >= 60 else pre["close"].min()) - 1.0) * 100.0
    return best


# ---------- named patterns ----------
def detect_flat_base(df: pd.DataFrame, p: Cfg) -> PatternResult | None:
    b = find_base(df, p.min_weeks * 5, p.max_weeks * 5, p.depth_max_pct)
    if b is None or (b.prior_run_pct is not None and b.prior_run_pct < p.prior_run_min_pct):
        return None
    return PatternResult(
        name="flat_base",
        resistance=b.resistance,
        base_low=b.low,
        base_start=df.index[b.start].date(),
        base_bars=b.bars,
        base_depth_pct=b.depth_pct,
        prior_run_pct=b.prior_run_pct,
        notes=[f"flat base {b.bars} bars, depth {b.depth_pct:.1f}%"],
    )


def detect_bull_flag(df: pd.DataFrame, p: Cfg) -> PatternResult | None:
    """Pole: >= pole_min_pct gain in <= pole_max_bars ending at a local top; flag: 5-20 bars, pullback <= max, lower volume."""
    n = len(df)
    close, high, low, vol = df["close"].to_numpy(), df["high"].to_numpy(), df["low"].to_numpy(), df["volume"].to_numpy()
    for flag_len in range(p.flag_min_bars, p.flag_max_bars + 1):
        top = n - 1 - flag_len  # pole top index
        if top < p.pole_max_bars + 5:
            continue
        pole_top = high[top]
        # flag must not exceed pole top and pullback measured from pole top to flag low
        flag = slice(top + 1, n)
        if high[flag].max() > pole_top * 1.005:
            continue
        pullback = (pole_top - low[flag].min()) / pole_top * 100.0
        if pullback > p.pullback_max_pct or pullback < 1.0:
            continue
        # pole: look back up to pole_max_bars for the low from which the run started
        pole_start = top - p.pole_max_bars
        pole_low = low[pole_start : top + 1].min()
        gain = (pole_top / pole_low - 1.0) * 100.0
        if gain < p.pole_min_pct:
            continue
        # drift: flag closes should not be rising faster than the pole (i.e. slope <= small positive)
        x = np.arange(flag_len)
        slope = np.polyfit(x, close[flag], 1)[0] / close[top]
        if slope > 0.003:
            continue
        if vol[flag].mean() >= vol[pole_start : top + 1].mean():
            continue
        return PatternResult(
            name="bull_flag",
            resistance=float(high[flag].max()),
            base_low=float(low[flag].min()),
            base_start=df.index[top + 1].date(),
            base_bars=flag_len,
            base_depth_pct=float(pullback),
            prior_run_pct=float(gain),
            notes=[f"pole +{gain:.0f}%, flag {flag_len} bars, pullback {pullback:.1f}%"],
        )
    return None


def detect_ascending_triangle(df: pd.DataFrame, p: Cfg, pivot_n: int = 3) -> PatternResult | None:
    for L in range(p.min_weeks * 5, p.max_weeks * 5 + 1, 5):
        if L >= len(df):
            break
        seg = df.iloc[-L:]
        highs, lows = swing_pivots(seg, pivot_n)
        if len(highs) < p.min_touches_top or len(lows) < 2:
            continue
        top = max(h for _, h in highs)
        touches = [h for _, h in highs if h >= top * (1 - p.top_flat_tol_pct / 100.0)]
        if len(touches) < p.min_touches_top:
            continue
        xs = np.array([i for i, _ in lows], dtype=float)
        ys = np.array([v for _, v in lows])
        slope, intercept = np.polyfit(xs, ys, 1)
        if slope <= 0:
            continue
        pred = slope * xs + intercept
        r2 = 1 - ((ys - pred) ** 2).sum() / max(((ys - ys.mean()) ** 2).sum(), 1e-9)
        if r2 < 0.5 and len(lows) > 2:
            continue
        if seg["close"].iloc[-1] < top * 0.90:
            continue
        return PatternResult(
            name="ascending_triangle",
            resistance=float(top),
            base_low=float(ys[-1]),  # stop under the most recent higher low, not the whole triangle
            base_start=seg.index[0].date(),
            base_bars=L,
            base_depth_pct=float((top - ys.min()) / top * 100.0),
            notes=[f"flat top {top:.2f} x{len(touches)}, rising lows r2={r2:.2f}"],
        )
    return None


def detect_cup_handle(df: pd.DataFrame, p: Cfg, pivot_n: int = 3) -> PatternResult | None:
    n = len(df)
    high, low, vol = df["high"].to_numpy(), df["low"].to_numpy(), df["volume"].to_numpy()
    for handle_len in range(p.handle_min_days, p.handle_max_days + 1):
        rim_r = n - 1 - handle_len  # right rim index
        if rim_r < p.cup_min_weeks * 5 + 10:
            continue
        right_rim = high[rim_r - 3 : rim_r + 1].max()
        handle = slice(rim_r + 1, n)
        if high[handle].max() > right_rim * 1.01:
            continue
        handle_depth = (right_rim - low[handle].min()) / right_rim * 100.0
        if handle_depth > p.handle_depth_max_pct or handle_depth < 1.0:
            continue
        max_cup = int(p.cup_max_months * 21)
        for cup_len in range(p.cup_min_weeks * 5, min(max_cup, rim_r) + 1, 5):
            rim_l = rim_r - cup_len
            left_rim = high[rim_l : rim_l + 4].max()
            if abs(left_rim / right_rim - 1.0) > 0.08:
                continue
            trough_i = rim_l + int(np.argmin(low[rim_l:rim_r]))
            depth = (max(left_rim, right_rim) - low[trough_i]) / max(left_rim, right_rim) * 100.0
            if not (p.cup_depth_min_pct <= depth <= p.cup_depth_max_pct):
                continue
            # U-shape: trough roughly centered (25-75%) and not a V (bars within 5% of trough low >= 3)
            pos = (trough_i - rim_l) / cup_len
            if not (0.2 <= pos <= 0.8):
                continue
            near_trough = (low[rim_l:rim_r] <= low[trough_i] * 1.05).sum()
            if near_trough < 3:
                continue
            cup_low = low[trough_i]
            if low[handle].min() < cup_low + (right_rim - cup_low) * 0.5:
                continue  # handle must sit in the upper half of the cup
            if vol[handle].mean() >= vol[rim_l:rim_r].mean():
                continue
            return PatternResult(
                name="cup_handle",
                resistance=float(right_rim),
                base_low=float(low[handle].min()),
                base_start=df.index[rim_l].date(),
                base_bars=cup_len + handle_len,
                base_depth_pct=float(depth),
                notes=[f"cup {cup_len} bars depth {depth:.0f}%, handle {handle_len} bars depth {handle_depth:.1f}%"],
            )
    return None


def detect_generic_base(df: pd.DataFrame, p: Cfg) -> PatternResult | None:
    b = find_base(df, p.min_weeks * 5, p.max_weeks * 5, p.depth_max_pct)
    if b is None:
        return None
    return PatternResult(
        name="generic_base",
        resistance=b.resistance,
        base_low=b.low,
        base_start=df.index[b.start].date(),
        base_bars=b.bars,
        base_depth_pct=b.depth_pct,
        prior_run_pct=b.prior_run_pct,
        notes=[f"consolidation {b.bars} bars, depth {b.depth_pct:.1f}%"],
    )


# ---------- quality components ----------
def vcp_contractions(df: pd.DataFrame, base_bars: int, pivot_n: int = 3) -> list[float]:
    """Successive pullback depths (%) from each pivot high to the next pivot low inside the base."""
    seg = df.iloc[-base_bars - pivot_n :]
    highs, lows = swing_pivots(seg, pivot_n)
    out = []
    for hi_i, hi_v in highs:
        nxt = [v for i, v in lows if i > hi_i]
        if nxt:
            out.append((hi_v - nxt[0]) / hi_v * 100.0)
    # add the final (possibly unconfirmed) contraction from the last pivot high to the latest low
    if highs:
        last_hi_i, last_hi_v = highs[-1]
        tail_low = seg["low"].iloc[last_hi_i + 1 :].min() if last_hi_i + 1 < len(seg) else None
        if tail_low is not None and not np.isnan(tail_low):
            d = (last_hi_v - tail_low) / last_hi_v * 100.0
            if not out or abs(out[-1] - d) > 1e-6:
                out.append(d)
    return [round(x, 2) for x in out if x > 0]


def vcp_ok(contractions: list[float], max_ratio: float, last_max_pct: float) -> bool:
    if len(contractions) < 2:
        return False
    for a, b in zip(contractions, contractions[1:], strict=False):
        if b > a * max_ratio:
            return False
    return contractions[-1] <= last_max_pct


def support_inside_base(df: pd.DataFrame, base_bars: int, base_low: float | None, pivot_n: int = 3) -> float | None:
    """Doc stop option 2: a support level inside the base (confirmed pivot low that is above the base low and was
    tested at least twice within ~1.5%). Returns the most recent such level, or None."""
    if not base_bars or base_low is None:
        return None
    seg = df.iloc[-(base_bars + pivot_n) :]
    _, lows = swing_pivots(seg, pivot_n)
    levels = [v for _, v in lows if v > base_low * 1.01]
    if not levels:
        return None
    # cluster: a level counts if another low (or the running min after it) sits within 1.5%
    for lv in reversed(levels):
        touches = sum(1 for v in levels if abs(v / lv - 1.0) <= 0.015)
        touches += int(((seg["low"] / lv - 1.0).abs() <= 0.015).sum() >= 2)
        if touches >= 2:
            return float(lv)
    return None


def overhead_supply(df: pd.DataFrame, price: float, p: Cfg) -> OverheadSupply:
    """Volume-at-price over the trailing lookback. Dense zone within zone_pct above price -> not clear sky."""
    look = df.iloc[-int(p.lookback_months * 21) :]
    if len(look) < 60:
        return OverheadSupply(clear_sky=True, note="insufficient history")
    hi_look = float(look["high"].max())
    if price >= hi_look * 0.995:
        return OverheadSupply(clear_sky=True, note="at/near multi-year high, no overhead")
    # The current base (last ~30 bars) is where price lives now; "overhead" means OLDER trading ABOVE it.
    recent, older = look.iloc[-30:], look.iloc[:-30]
    base_top = float(recent["high"].max())
    if older.empty:
        return OverheadSupply(clear_sky=True, note="insufficient history")
    lo, hi = float(look["low"].min()), hi_look
    edges = np.linspace(lo, hi, int(p.bins) + 1)
    vap, _ = np.histogram(older["close"], bins=edges, weights=older["volume"])
    thresh = np.quantile(vap[vap > 0], p.dense_quantile) if (vap > 0).any() else np.inf
    zone_hi = price * (1 + p.zone_pct_above / 100.0)
    idx = [i for i in range(len(vap)) if edges[i] >= base_top * 0.995 and edges[i] < zone_hi]
    dense = [i for i in idx if vap[i] >= thresh]
    if dense:
        zl, zh = float(edges[min(dense)]), float(edges[max(dense) + 1])
        return OverheadSupply(
            clear_sky=False,
            dense_zone_low=zl,
            dense_zone_high=zh,
            dense_pct_above_price=(zl / price - 1.0) * 100.0,
            note=f"dense supply {zl:.2f}-{zh:.2f} ({(zl / price - 1) * 100:.1f}% above)",
        )
    return OverheadSupply(clear_sky=True, note=f"no dense zone within {p.zone_pct_above:.0f}%")


def base_count(df: pd.DataFrame, lookback: int = 300, depth_max_pct: float = 15.0, min_bars: int = 20) -> int:
    """Approximate IBD base count: consolidations (>= min_bars, depth <= 15%) separated by >= 20% advances,
    reset when price falls >= 20% from a prior base high."""
    seg = df.iloc[-lookback:]
    close = seg["close"].to_numpy()
    n = len(close)
    count, i, last_base_high = 0, 0, None
    while i + min_bars <= n:
        win = close[i : i + min_bars]
        depth = (win.max() - win.min()) / win.max() * 100.0
        if depth <= depth_max_pct:
            # extend
            j = i + min_bars
            while j < n and (close[i : j + 1].max() - close[i : j + 1].min()) / close[i : j + 1].max() * 100.0 <= depth_max_pct:
                j += 1
            b_high = close[i:j].max()
            if last_base_high is None or b_high >= last_base_high * 1.20:
                count += 1
            elif b_high < last_base_high * 0.80:
                count = 1
            last_base_high = b_high
            i = j
        else:
            if last_base_high is not None and close[i] < last_base_high * 0.80:
                count, last_base_high = 0, None
            i += 1
    return max(count, 1)


# ---------- doc scores ----------
def trend_score(df: pd.DataFrame, base_bars: int, near_high_pct: float = 10.0, pivot_n: int = 3) -> TrendScore:
    from swing.indicators import high_52w, higher_highs_lows

    c = df["close"]
    close = float(c.iloc[-1])
    hh, hl = higher_highs_lows(df, window=max(60, base_bars + 20), pivot=pivot_n)
    return TrendScore(
        price_above_ma200=bool(close > sma(c, 200).iloc[-1]),
        ma50_above_ma200=bool(sma(c, 50).iloc[-1] > sma(c, 200).iloc[-1]),
        ema8_above_ema21=bool(ema(c, 8).iloc[-1] > ema(c, 21).iloc[-1]),
        price_above_ema8=bool(close > ema(c, 8).iloc[-1]),
        higher_highs=hh,
        higher_lows=hl,
        volume_drying_in_base=volume_drying(df, max(base_bars, 5)),
        within_10pct_52w_high=bool((1 - close / float(high_52w(df).iloc[-1])) * 100.0 <= near_high_pct),
    )


def weekly_check(df_daily: pd.DataFrame, overhead: OverheadSupply) -> WeeklyCheck:
    from swing.data.bars import weekly
    from swing.indicators import weekly_features

    wk = weekly(df_daily)
    f = weekly_features(wk)
    return WeeklyCheck(
        rising_right=bool(f["rising_right"]),
        above_30w_ma=bool(f["above_30w"]),
        ma30w_rising=bool(f["ma30w_rising"]),
        near_1y_high=bool(f["near_1y_high"]),
        overhead=overhead,
    )


# ---------- orchestration ----------
def detect_pattern(df: pd.DataFrame, cfg: Cfg | None = None) -> PatternResult:
    """Doc order: bull flag -> flat base -> ascending triangle -> cup & handle -> generic base -> none."""
    cfg = cfg or load_config()
    p = cfg.patterns
    for fn, sub in (
        (detect_bull_flag, p.bull_flag),
        (detect_flat_base, p.flat_base),
        (detect_ascending_triangle, p.asc_triangle),
        (detect_cup_handle, p.cup_handle),
        (detect_generic_base, p.base_general),
    ):
        res = fn(df, sub)
        if res is not None:
            return res
    return PatternResult(name="none")


def quality_score(df: pd.DataFrame, pat: PatternResult, cfg: Cfg | None = None) -> PatternResult:
    """0-10 base-quality score: pattern type, depth, VCP, volume dry-up, tightness, base count."""
    cfg = cfg or load_config()
    p = cfg.patterns
    if pat.name == "none" or not pat.base_bars:
        return pat
    score = {"flat_base": 4.0, "bull_flag": 3.5, "ascending_triangle": 3.0, "cup_handle": 3.0, "generic_base": 2.0}[pat.name]
    if pat.base_depth_pct is not None:
        score += 1.5 if pat.base_depth_pct <= 10 else (0.75 if pat.base_depth_pct <= 15 else 0.0)
    pat.vcp_contractions = vcp_contractions(df, pat.base_bars, p.pivot_window)
    pat.vcp_ok = vcp_ok(pat.vcp_contractions, p.vcp.max_ratio, p.vcp.last_contraction_max_pct)
    score += 1.5 if pat.vcp_ok else 0.0
    pat.volume_dry_up = volume_drying(df, pat.base_bars)
    score += 1.0 if pat.volume_dry_up else 0.0
    pat.bbwidth_at_low = bb_width_at_low(df["close"])
    from swing.indicators import atr

    a10, a50 = atr(df, 10).iloc[-1], atr(df, 50).iloc[-1]
    pat.atr_ratio_10_50 = float(a10 / a50) if a50 else None
    tight = pat.bbwidth_at_low or (pat.atr_ratio_10_50 is not None and pat.atr_ratio_10_50 < 0.7)
    score += 1.0 if tight else 0.0
    pat.support_low = support_inside_base(df, pat.base_bars, pat.base_low, p.pivot_window)
    pat.base_count = base_count(df)
    if pat.base_count >= 3:
        score -= 1.0
        pat.notes.append(f"late-stage base #{pat.base_count}")
    pat.quality_score = float(max(0.0, min(10.0, score)))
    return pat
