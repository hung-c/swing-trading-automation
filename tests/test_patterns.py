from swing.patterns import (
    base_count,
    detect_bull_flag,
    detect_cup_handle,
    detect_flat_base,
    detect_pattern,
    find_base,
    overhead_supply,
    quality_score,
    swing_pivots,
    trend_score,
    vcp_ok,
    weekly_check,
)


def test_swing_pivots_confirmed_only(flat_base_frame):
    highs, lows = swing_pivots(flat_base_frame, 3)
    n = len(flat_base_frame)
    assert all(i <= n - 4 for i, _ in highs + lows)  # last 3 bars can never be confirmed pivots
    assert len(highs) > 5 and len(lows) > 5


def test_find_base_on_flat_base(flat_base_frame, cfg):
    p = cfg.patterns.flat_base
    b = find_base(flat_base_frame, p.min_weeks * 5, p.max_weeks * 5, p.depth_max_pct)
    assert b is not None
    assert 25 <= b.bars <= 40
    assert b.depth_pct <= 15
    assert b.low < b.resistance <= b.high
    assert b.prior_run_pct and b.prior_run_pct > 20


def test_detect_flat_base(flat_base_frame, cfg):
    r = detect_flat_base(flat_base_frame, cfg.patterns.flat_base)
    assert r is not None and r.name == "flat_base"
    assert r.resistance > r.base_low


def test_detect_bull_flag(bull_flag_frame, cfg):
    r = detect_bull_flag(bull_flag_frame, cfg.patterns.bull_flag)
    assert r is not None and r.name == "bull_flag"
    assert 5 <= r.base_bars <= 20
    assert r.prior_run_pct >= cfg.patterns.bull_flag.pole_min_pct
    assert r.base_depth_pct <= cfg.patterns.bull_flag.pullback_max_pct


def test_detect_cup_handle(cup_handle_frame, cfg):
    r = detect_cup_handle(cup_handle_frame, cfg.patterns.cup_handle)
    assert r is not None and r.name == "cup_handle"
    assert 12 <= r.base_depth_pct <= 33
    assert r.base_low > 0 and r.resistance > r.base_low


def test_detect_pattern_order_prefers_flag_then_flat(bull_flag_frame, flat_base_frame, cfg):
    assert detect_pattern(bull_flag_frame, cfg).name == "bull_flag"
    assert detect_pattern(flat_base_frame, cfg).name in ("flat_base", "bull_flag")


def test_downtrend_has_no_pattern(downtrend, cfg):
    assert detect_pattern(downtrend, cfg).name in ("none", "generic_base")


def test_vcp_ok_rule():
    assert vcp_ok([25.0, 14.0, 7.0], 0.75, 10.0)
    assert not vcp_ok([10.0, 12.0], 0.75, 10.0)  # expanding
    assert not vcp_ok([25.0, 15.0, 12.0], 0.75, 10.0)  # last too deep
    assert not vcp_ok([5.0], 0.75, 10.0)


def test_quality_score_bounds(flat_base_frame, cfg):
    pat = quality_score(flat_base_frame, detect_pattern(flat_base_frame, cfg), cfg)
    assert 0 <= pat.quality_score <= 10
    assert pat.volume_dry_up is True  # fixture dries volume in the base
    assert pat.base_count >= 1


def test_overhead_supply_clear_at_highs(flat_base_frame, cfg):
    price = float(flat_base_frame["close"].iloc[-1])
    o = overhead_supply(flat_base_frame, price, cfg.patterns.overhead_supply)
    assert o.clear_sky


def test_overhead_supply_flags_dense_zone_above(cfg):
    # heavy trading at ~60 for 60 bars, collapse to 45, then a tight base at 50-52 -> wall ~15% above (outside 10% zone)
    # and a second variant with the wall 6% above -> flagged
    from conftest import make_bars

    far = make_bars([(200, 20.0, 2.0), (60, 0.0, 1.5), (15, -25.0, 3.0), (30, 0.0, 1.0)], start_price=50.0, volume_mult=[1, 3, 1, 0.6])
    price = float(far["close"].iloc[-1])
    o = overhead_supply(far, price, cfg.patterns.overhead_supply)
    assert o.clear_sky  # wall is ~33% above, outside the 10% zone

    near = make_bars([(200, 20.0, 2.0), (60, 0.0, 1.5), (15, -6.0, 2.0), (30, 0.0, 1.0)], start_price=50.0, volume_mult=[1, 3, 1, 0.6])
    price = float(near["close"].iloc[-1])
    o = overhead_supply(near, price, cfg.patterns.overhead_supply)
    assert not o.clear_sky
    assert o.dense_zone_low >= price


def test_trend_score_uptrend(flat_base_frame):
    ts = trend_score(flat_base_frame, base_bars=30)
    assert ts.price_above_ma200 and ts.ma50_above_ma200 and ts.within_10pct_52w_high
    assert ts.score >= 6
    assert set(ts.missing).isdisjoint({"price_above_ma200", "ma50_above_ma200"})


def test_trend_score_downtrend(downtrend):
    ts = trend_score(downtrend, base_bars=20)
    assert ts.score <= 3


def test_weekly_check(flat_base_frame, cfg):
    o = overhead_supply(flat_base_frame, float(flat_base_frame.close.iloc[-1]), cfg.patterns.overhead_supply)
    w = weekly_check(flat_base_frame, o)
    assert w.above_30w_ma and w.ma30w_rising and w.rising_right and w.near_1y_high
    assert w.passed


def test_base_count_reasonable(flat_base_frame):
    assert 1 <= base_count(flat_base_frame) <= 5
