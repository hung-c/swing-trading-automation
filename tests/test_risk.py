from datetime import date

from swing.agents import pattern, risk, screener
from swing.journal import close_position, heat_pct, latest_plans, open_positions, save_plans, upsert_position
from swing.models import EarningsInfo, Position


def _candidates(frame, cfg, symbol="FLAT", sector="Technology", earnings=None):
    out = screener.screen({symbol: frame}, {symbol: {"market_cap": 5e9, "sector": sector}}, {symbol: earnings} if earnings else {}, cfg)
    rows = out.rows or out.excluded_earnings
    kept, dropped = pattern.run(rows, {symbol: frame}, cfg)
    return kept, dropped


def test_pattern_agent_keeps_flat_base(flat_base_frame, cfg):
    kept, dropped = _candidates(flat_base_frame, cfg)
    assert kept, [d.dropped_reason for d in dropped]
    c = kept[0]
    assert c.pattern.name in ("flat_base", "bull_flag")
    assert c.trend.score >= 6 and c.weekly.passed


def test_plan_math(flat_base_frame, cfg):
    kept, _ = _candidates(flat_base_frame, cfg)
    plan = risk.build_plan(kept[0], cfg)
    assert plan.entry > plan.resistance >= plan.stop
    assert abs(plan.entry / plan.resistance - 1.005) < 1e-3
    assert abs(plan.target_2r - (plan.entry + 2 * plan.risk_per_share)) < 0.011
    assert plan.shares >= 1
    assert plan.shares * plan.risk_per_share <= cfg.account.size_usd * cfg.account.risk_pct_per_trade / 100.0 + 1e-6
    assert "Resistance" in plan.card_text()


def test_plan_rejects_earnings(flat_base_frame, cfg):
    e = EarningsInfo(symbol="FLAT", date=date(2026, 10, 9), trading_days_away=2)
    kept, _ = _candidates(flat_base_frame, cfg, earnings=e)
    plan = risk.build_plan(kept[0], cfg)
    assert plan.status == "rejected" and "earnings" in plan.rejected_reason


def test_sector_cap_and_heat(flat_base_frame, cfg, tmp_path):
    kept, _ = _candidates(flat_base_frame, cfg)
    plan = risk.build_plan(kept[0], cfg)
    positions = [
        Position(symbol="A", opened=date(2026, 10, 1), entry=100, stop=95, initial_stop=95, shares=5, target_2r=110, sector="Technology"),
        Position(symbol="B", opened=date(2026, 10, 1), entry=50, stop=48, initial_stop=48, shares=10, target_2r=54, sector="Technology"),
    ]
    out = risk.apply_portfolio_rules([plan], positions, cfg)
    assert out[0].status == "rejected" and "sector cap" in out[0].rejected_reason

    plan2 = risk.build_plan(kept[0], cfg)
    plan2.sector = "Energy"
    big = [Position(symbol="C", opened=date(2026, 10, 1), entry=100, stop=90, initial_stop=90, shares=28, target_2r=120, sector="Energy")]  # 5.6% heat
    out = risk.apply_portfolio_rules([plan2], big, cfg)
    assert out[0].status == "watch" and any("heat" in n for n in out[0].notes)


def test_journal_roundtrip(flat_base_frame, cfg, tmp_path):
    db = tmp_path / "j.sqlite"
    kept, _ = _candidates(flat_base_frame, cfg)
    plan = risk.build_plan(kept[0], cfg)
    save_plans(date(2026, 10, 7), [plan], db)
    got = latest_plans("watch", db)
    assert len(got) == 1 and got[0].symbol == "FLAT" and got[0].entry == plan.entry

    pos = Position(symbol="FLAT", opened=date(2026, 10, 8), entry=plan.entry, stop=plan.stop, initial_stop=plan.stop, shares=plan.shares, target_2r=plan.target_2r, sector="Technology")
    upsert_position(pos, db)
    assert heat_pct(cfg.account.size_usd, path=db) > 0
    closed = close_position("FLAT", plan.target_2r, date(2026, 10, 20), db)
    assert closed and abs(closed.r_multiple - 2.0) < 0.05
    assert open_positions(db) == []
