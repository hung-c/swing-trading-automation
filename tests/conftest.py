"""Synthetic OHLCV fixtures. Deterministic piecewise price paths so pattern/screener tests are reproducible."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from swing.config import load_config


def make_bars(
    segments: list[tuple[int, float, float]],
    start_price: float = 50.0,
    start: str = "2023-01-02",
    base_volume: float = 2_000_000,
    volume_mult: list[float] | None = None,
    seed: int = 7,
) -> pd.DataFrame:
    """segments: [(n_bars, total_pct_change_over_segment, daily_range_pct), ...].

    volume_mult: optional per-segment multiplier on base_volume (e.g. [1, 0.6] -> volume dries up in segment 2).
    Returns a daily frame indexed by NYSE sessions with open/high/low/close/volume/vwap.
    """
    rng = np.random.default_rng(seed)
    closes, ranges, vols = [], [], []
    price = start_price
    for i, (n, total_pct, rng_pct) in enumerate(segments):
        log_step = np.log(1 + total_pct / 100.0) / max(n, 1)
        vm = (volume_mult or [1.0] * len(segments))[i]
        noise = rng.normal(0, rng_pct / 100.0 * 0.25, n)
        noise -= noise.mean()  # segment lands exactly on its target
        for k in range(n):
            price *= float(np.exp(log_step + noise[k]))
            closes.append(price)
            ranges.append(rng_pct / 100.0 * price)
            vols.append(base_volume * vm * rng.uniform(0.7, 1.3))
    n = len(closes)
    idx = pd.bdate_range(start, periods=n, freq="C", holidays=[])
    close = np.array(closes)
    rngs = np.array(ranges)
    high = close + rngs * rng.uniform(0.3, 0.7, n)
    low = high - rngs
    open_ = low + rngs * rng.uniform(0.2, 0.8, n)
    df = pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": np.array(vols)}, index=idx)
    df.index.name = "date"
    df["vwap"] = (df.high + df.low + df.close) / 3
    return df


@pytest.fixture
def cfg():
    return load_config()


@pytest.fixture
def uptrend_tight():
    """~300 bars: long uptrend then a 6-week tight flat base near highs. Passes Scan A."""
    return make_bars([(250, 80.0, 2.0), (30, 1.0, 1.2)], start_price=40.0, volume_mult=[1.0, 0.6])


@pytest.fixture
def downtrend():
    return make_bars([(300, -40.0, 3.0)], start_price=100.0)


@pytest.fixture
def flat_base_frame():
    """Prior run +35% over 60 bars, then 6-week flat base (30 bars) with ~6% depth and drying volume."""
    return make_bars([(220, 30.0, 2.0), (60, 35.0, 2.2), (30, 0.5, 1.0)], start_price=30.0, volume_mult=[1, 1.2, 0.6])


@pytest.fixture
def bull_flag_frame():
    """Prior trend, 10-bar pole +25%, then 10-bar flag drifting -6% with lower volume."""
    return make_bars([(230, 25.0, 2.0), (10, 25.0, 2.5), (10, -6.0, 1.3)], start_price=30.0, volume_mult=[1, 1.5, 0.6])


@pytest.fixture
def cup_handle_frame():
    """Uptrend, cup: -22% over 40 bars then +27% over 40 bars (back near rim), handle: -7% over 8 bars."""
    return make_bars(
        [(200, 60.0, 2.0), (40, -22.0, 2.0), (40, 27.0, 1.8), (8, -7.0, 1.2)],
        start_price=30.0,
        volume_mult=[1, 1, 0.9, 0.5],
    )
