import pandas as pd

from swing.agents.screener import apply_ladder, compute_features, finviz_url, screen, trend_template
from swing.config import Cfg
from swing.indicators import daily_features, rs_ratings, weekly_volatility_pct
from swing.models import EarningsInfo


def test_daily_features_fields(uptrend_tight):
    f = daily_features(uptrend_tight)
    assert f is not None
    for k in ("close", "sma50", "sma200", "avg_vol_63", "high_52w", "pct_below_52w_high", "weekly_volatility_pct", "atr14", "adr20_pct", "rs_raw"):
        assert k in f
    assert f["close"] > f["sma50"] > f["sma200"]
    assert 0 <= f["pct_below_52w_high"] < 10


def test_weekly_volatility_is_mean_range_pct():
    df = pd.DataFrame({"high": [102, 103, 104, 105, 106], "low": [100] * 5, "close": [100] * 5})
    v = weekly_volatility_pct(df).iloc[-1]
    assert abs(v - 4.0) < 1e-9  # mean of 2,3,4,5,6 %


def test_rs_rating_range():
    r = rs_ratings(pd.Series([0.1, 0.5, -0.2, 0.9, 0.0]))
    assert int(r.min()) >= 1 and int(r.max()) <= 99
    assert int(r.iloc[3]) == 99


def test_screen_passes_uptrend_rejects_downtrend(uptrend_tight, downtrend, cfg):
    frames = {"GOOD": uptrend_tight, "BAD": downtrend}
    meta = {"GOOD": {"market_cap": 5e9, "sector": "Technology"}, "BAD": {"market_cap": 5e9, "sector": "Energy"}}
    out = screen(frames, meta, {}, cfg)
    syms = {r.symbol for r in out.rows}
    assert "GOOD" in syms and "BAD" not in syms


def test_ladder_never_relaxes_sma(uptrend_tight, cfg):
    feats = compute_features({"X": uptrend_tight}, {"X": {"market_cap": 5e9}})
    # force a failing SMA relationship: push close below sma50
    feats.loc["X", "close"] = feats.loc["X", "sma50"] * 0.9
    mask, step, strict = apply_ladder(feats, cfg)
    assert strict == 0 and int(mask.sum()) == 0
    assert step == len(cfg.screener.ladder)  # exhausted the ladder without passing


def test_ladder_relaxes_market_cap(uptrend_tight, cfg):
    feats = compute_features({"X": uptrend_tight}, {"X": {"market_cap": 1.5e9}})
    mask, step, strict = apply_ladder(feats, cfg)
    assert strict == 0
    assert int(mask.sum()) == 1
    assert step == 4  # market cap is the last ladder step


def test_earnings_exclusion(uptrend_tight, cfg):
    e = EarningsInfo(symbol="GOOD", trading_days_away=3)
    out = screen({"GOOD": uptrend_tight}, {"GOOD": {"market_cap": 5e9}}, {"GOOD": e}, cfg)
    assert out.rows == [] and len(out.excluded_earnings) == 1
    assert "earnings" in out.excluded_earnings[0].excluded_reason


def test_trend_template(uptrend_tight, cfg):
    feats = compute_features({"X": uptrend_tight}, {"X": {"market_cap": 5e9}})
    feats["rs_rating"] = 90
    ok, fails = trend_template(feats.loc["X"], cfg.screener)
    assert ok, fails
    feats.loc["X", "rs_rating"] = 40
    ok, fails = trend_template(feats.loc["X"], cfg.screener)
    assert not ok and any("RS" in f for f in fails)


def test_finviz_url_matches_doc(cfg):
    u = finviz_url(cfg)
    for part in ("cap_midover", "sh_avgvol_o1000", "sh_price_o10", "ta_highlow52w_b0to10h", "ta_sma200_pa", "ta_sma200_sb50", "ta_sma50_pa", "ta_volatility_wo3"):
        assert part in u


def test_cfg_update_preserves_types(cfg):
    p = dict(cfg.screener)
    p.update({"market_cap_min": 1.0e9})
    assert Cfg(p).market_cap_min == 1.0e9
