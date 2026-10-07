from datetime import date, datetime

from swing import llm
from swing import notion_publisher as npub
from swing.agents import pattern, risk, screener
from swing.charts import charts_for_plan
from swing.models import Alert, DailyBrief, ManageAction, Position, RegimeReport, TickerNews


def _brief(flat_base_frame, cfg) -> DailyBrief:
    out = screener.screen({"FLAT": flat_base_frame}, {"FLAT": {"market_cap": 5e9, "sector": "Technology"}}, {}, cfg)
    kept, _ = pattern.run(out.rows, {"FLAT": flat_base_frame}, cfg)
    watch, rejected = risk.run(kept, [], cfg)
    reg = RegimeReport(as_of=date(2026, 10, 7), spy_close=1.0, qqq_close=1.0, spy_above_50=True, qqq_above_50=True, spy_above_200=True, qqq_above_200=True, sizing="full", notes=["both indices above MA50"])
    return DailyBrief(
        date=date(2026, 10, 7), kind="nightly", regime=reg, screen_count_strict=1, screen_count_final=1, weekly_survivors=1,
        plans=watch, rejected=rejected, news=[TickerNews(symbol="FLAT")],
        positions=[Position(symbol="X", opened=date(2026, 10, 1), entry=10, stop=9.5, initial_stop=9.5, shares=10, target_2r=11)],
        manage=[ManageAction(symbol="X", action="trail_stop_8ema", reason="above 8 EMA", new_stop=9.8)],
        alerts=[Alert(ts=datetime(2026, 10, 7, 11, 40), symbol="FLAT", condition="breakout", price=53.4, actionable=True)],
        heat_pct=1.0,
    )


def test_template_brief_validates(flat_base_frame, cfg, monkeypatch):
    monkeypatch.delenv("GROQ_KEY", raising=False)
    monkeypatch.delenv("GEMINI_KEY", raising=False)
    b = _brief(flat_base_frame, cfg)
    prose, provider = llm.write(b, cfg)  # no keys -> template
    assert provider == "template"
    assert "FLAT" in prose.watchlist_commentary
    assert len(prose.tomorrow_checklist) >= 3


def test_facts_contain_no_rejected_as_plans(flat_base_frame, cfg):
    b = _brief(flat_base_frame, cfg)
    facts = llm._facts(b)
    assert all(p["symbol"] not in {r["symbol"] for r in facts["rejected"]} for p in facts["plans"])
    assert facts["regime"]["sizing"] == "full"


def test_notion_blocks_build_without_network(flat_base_frame, cfg):
    b = _brief(flat_base_frame, cfg)
    b.prose, b.llm_provider = llm.template(b), "template"
    blocks = npub._regime_blocks(b) + npub._plan_blocks(b, upload_charts=False) + npub._news_blocks(b) + npub._ops_blocks(b)
    assert any(x["type"] == "callout" for x in blocks)
    assert any(x["type"] == "code" for x in blocks)
    assert any(x["type"] == "to_do" for x in blocks)
    for x in blocks:
        for v in x.values():
            if isinstance(v, dict) and "rich_text" in v:
                assert all(len(t["text"]["content"]) <= 2000 for t in v["rich_text"])


def test_charts_render(flat_base_frame, cfg, tmp_path, monkeypatch):
    b = _brief(flat_base_frame, cfg)
    assert b.plans, [p.rejected_reason for p in b.rejected]
    monkeypatch.setattr("swing.charts.ROOT", tmp_path)
    paths = charts_for_plan(b.plans[0], flat_base_frame, "2026-10-07")
    assert set(paths) >= {"weekly", "daily"}
    for p in paths.values():
        assert (tmp_path / "out").exists() and p.endswith(".png")
