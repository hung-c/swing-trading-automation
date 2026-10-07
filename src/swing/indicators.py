"""Technical indicators on daily / intraday OHLCV frames. Pure pandas, no look-ahead (everything uses bars <= t)."""

from __future__ import annotations

import numpy as np
import pandas as pd


# ---------- moving averages ----------
def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def rising(s: pd.Series, sessions: int) -> bool:
    """True if the series is higher than `sessions` bars ago (simple slope test)."""
    s = s.dropna()
    if len(s) <= sessions:
        return False
    return bool(s.iloc[-1] > s.iloc[-1 - sessions])


# ---------- volatility ----------
def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()], axis=1)
    return tr.max(axis=1)


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    return true_range(df).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def adr_pct(df: pd.DataFrame, n: int = 20) -> pd.Series:
    """Kullamagi ADR%: mean over n days of (High/Low - 1) * 100."""
    return ((df["high"] / df["low"] - 1.0) * 100.0).rolling(n, min_periods=n).mean()


def weekly_volatility_pct(df: pd.DataFrame, n: int = 5) -> pd.Series:
    """Finviz 'Volatility (Week)': average daily range as % of close over the last 5 sessions."""
    return ((df["high"] - df["low"]) / df["close"] * 100.0).rolling(n, min_periods=n).mean()


def bb_width(close: pd.Series, n: int = 20, k: float = 2.0) -> pd.Series:
    m = sma(close, n)
    sd = close.rolling(n, min_periods=n).std(ddof=0)
    return (2 * k * sd) / m


def bb_width_at_low(close: pd.Series, n: int = 20, lookback: int = 125, tol: float = 1.10) -> bool:
    """Bollinger 'Squeeze': current BandWidth within tol of its 6-month low."""
    w = bb_width(close, n).dropna()
    if len(w) < lookback:
        return False
    return bool(w.iloc[-1] <= w.iloc[-lookback:].min() * tol)


# ---------- position in range ----------
def high_52w(df: pd.DataFrame, n: int = 252) -> pd.Series:
    return df["high"].rolling(n, min_periods=min(n, len(df))).max()


def low_52w(df: pd.DataFrame, n: int = 252) -> pd.Series:
    return df["low"].rolling(n, min_periods=min(n, len(df))).min()


def pct_below_high(close: float, hi: float) -> float:
    return (1.0 - close / hi) * 100.0 if hi else np.nan


def pct_above_low(close: float, lo: float) -> float:
    return (close / lo - 1.0) * 100.0 if lo else np.nan


# ---------- relative strength (IBD approximation) ----------
def rs_raw(close: pd.Series) -> float | None:
    """0.4*ROC63 + 0.2*ROC126 + 0.2*ROC189 + 0.2*ROC252 (trading days). None if < 252 bars."""
    c = close.dropna()
    if len(c) < 253:
        return None
    roc = lambda n: c.iloc[-1] / c.iloc[-1 - n] - 1.0  # noqa: E731
    return float(0.4 * roc(63) + 0.2 * roc(126) + 0.2 * roc(189) + 0.2 * roc(252))


def rs_ratings(raw: pd.Series) -> pd.Series:
    """Percentile-rank across the universe -> 1..99."""
    pct = raw.rank(pct=True)
    return (pct * 98 + 1).round().astype("Int64")


# ---------- structure ----------
def higher_highs_lows(df: pd.DataFrame, window: int = 60, pivot: int = 3) -> tuple[bool, bool]:
    """Compare the last two confirmed swing highs / lows inside `window` bars."""
    from swing.patterns import swing_pivots

    sub = df.iloc[-window:]
    highs, lows = swing_pivots(sub, pivot)
    hh = len(highs) >= 2 and highs[-1][1] > highs[-2][1]
    hl = len(lows) >= 2 and lows[-1][1] > lows[-2][1]
    return bool(hh), bool(hl)


def volume_drying(df: pd.DataFrame, base_bars: int, ref: int = 50) -> bool:
    """Mean volume over the base < 50-day average volume measured before the base started."""
    if len(df) < base_bars + ref:
        return False
    base_vol = df["volume"].iloc[-base_bars:].mean()
    ref_vol = df["volume"].iloc[-(base_bars + ref) : -base_bars].mean()
    return bool(base_vol < ref_vol)


# ---------- intraday ----------
def session_vwap(intra: pd.DataFrame) -> pd.Series:
    """Cumulative VWAP per session from intraday bars (index tz-aware ET)."""
    tp = (intra["high"] + intra["low"] + intra["close"]) / 3
    pv = tp * intra["volume"]
    day = intra.index.date
    return pv.groupby(day).cumsum() / intra["volume"].groupby(day).cumsum()


def time_adjusted_rvol(intra: pd.DataFrame, now_ts: pd.Timestamp, baseline_sessions: int = 20) -> float | None:
    """CumVol_today(t) / mean over prior N sessions of CumVol_d(t), same clock time. Needs intraday bars."""
    if intra.empty:
        return None
    t = now_ts.tz_convert(intra.index.tz).time() if now_ts.tzinfo else now_ts.time()
    today = now_ts.tz_convert(intra.index.tz).date() if now_ts.tzinfo else now_ts.date()
    by_day = {d: g for d, g in intra.groupby(intra.index.date)}
    if today not in by_day:
        return None
    cum_today = by_day[today][by_day[today].index.time <= t]["volume"].sum()
    prior = [d for d in sorted(by_day) if d < today][-baseline_sessions:]
    if not prior:
        return None
    base = [by_day[d][by_day[d].index.time <= t]["volume"].sum() for d in prior]
    base = [b for b in base if b > 0]
    if not base:
        return None
    return float(cum_today / (sum(base) / len(base)))


# ---------- feature bundle ----------
def daily_features(df: pd.DataFrame) -> dict | None:
    """Everything Scan A + Trend Template needs for the LAST bar of df. None if too short (< 200 bars)."""
    if df is None or len(df) < 200:
        return None
    c = df["close"]
    f: dict = {}
    f["close"] = float(c.iloc[-1])
    f["sma50"] = float(sma(c, 50).iloc[-1])
    f["sma150"] = float(sma(c, 150).iloc[-1]) if len(c) >= 150 else None
    s200 = sma(c, 200)
    f["sma200"] = float(s200.iloc[-1])
    f["sma200_rising"] = rising(s200, 20)
    f["ema8"] = float(ema(c, 8).iloc[-1])
    f["ema21"] = float(ema(c, 21).iloc[-1])
    f["avg_vol_63"] = float(df["volume"].iloc[-63:].mean())
    f["avg_vol_50"] = float(df["volume"].iloc[-50:].mean())
    f["high_52w"] = float(high_52w(df).iloc[-1])
    f["low_52w"] = float(low_52w(df).iloc[-1])
    f["pct_below_52w_high"] = pct_below_high(f["close"], f["high_52w"])
    f["pct_above_52w_low"] = pct_above_low(f["close"], f["low_52w"])
    f["weekly_volatility_pct"] = float(weekly_volatility_pct(df).iloc[-1])
    f["atr14"] = float(atr(df, 14).iloc[-1])
    a10, a50 = atr(df, 10).iloc[-1], atr(df, 50).iloc[-1] if len(df) >= 50 else np.nan
    f["atr_ratio_10_50"] = float(a10 / a50) if a50 and not np.isnan(a50) else None
    f["adr20_pct"] = float(adr_pct(df, 20).iloc[-1])
    f["rs_raw"] = rs_raw(c)
    f["bbwidth_at_low"] = bb_width_at_low(c)
    return f


def weekly_features(wk: pd.DataFrame) -> dict:
    """Weinstein Stage-2 inputs from a weekly frame."""
    c = wk["close"]
    out: dict = {"above_30w": None, "ma30w_rising": None, "near_1y_high": None, "rising_right": None}
    if len(c) < 32:
        return out
    m30 = sma(c, 30)
    out["above_30w"] = bool(c.iloc[-1] > m30.iloc[-1])
    out["ma30w_rising"] = rising(m30, 4)
    hi1y = wk["high"].iloc[-52:].max()
    out["near_1y_high"] = bool(c.iloc[-1] >= 0.85 * hi1y)
    # "rising right": last 26 weeks close > close 26 weeks ago and 52 weeks ago
    out["rising_right"] = bool(c.iloc[-1] > c.iloc[-27] and (len(c) < 53 or c.iloc[-1] > c.iloc[-53]))
    return out
