import json
from datetime import date, datetime

from swing import evaluate, journal
from swing.models import Alert, ManageAction, PlanCard, RegimeReport, TickerNews, NewsItem


def _plan(**kwargs) -> PlanCard:
    base = dict(
        symbol="FLAT",
        pattern="flat_base",
        resistance=50.0,
        entry=50.4,
        stop=47.0,
        risk_per_share=3.4,
        stop_pct=6.7,
        shares=2,
        fractional_shares=2.0,
        notional=100.8,
        target_2r=57.2,
        target_3r=60.6,
        atr14=1.2,
        stop_atr_mult=2.8,
        trend_score=7,
        pattern_quality=8.0,
        alert_level=50.4,
        status="watch",
        chart_paths={"daily": "out/FLAT-daily.png"},
        notes=["tight base"],
    )
    base.update(kwargs)
    return PlanCard(**base)


def _payload(plan_card=True, alert=False, management=False, direction="Orderly tight bases near highs."):
    return {
        "evaluator": {
            "gates": {"plan_card": plan_card, "actionable_alert": alert, "management": management},
            "direction": direction,
            "must_pass": "The base is orderly.",
            "disqualify": "The base is messy.",
            "do_not": "Do not change the stop.",
        }
    }


def _save_strategy(path, payload, status="active", sid="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"):
    with journal.connect(path) as db:
        db.execute(
            "INSERT INTO strategies (id, name, status, payload, updated_at) VALUES (?,?,?,?,?)",
            (sid, "Swing", status, json.dumps(payload), "2026-10-08T15:00:00+00:00"),
        )


def _regime() -> RegimeReport:
    return RegimeReport(as_of=date(2026, 10, 8), sizing="full", notes=["both indices above MA50"])


def test_take_without_a_reason_stays_a_watch():
    ev = evaluate._finish(evaluate.TickerVerdictBody(verdict="take", reasons=[]), "groq:x", "abc123abc123", "plan_card")
    assert ev.verdict == "watch"
    assert ev.prompt_version == "abc123abc123"
    assert any("no reason" in q.lower() for q in ev.open_questions)


def test_prompt_version_tracks_the_instructions():
    a = evaluate.instructions_from_payload(_payload())
    b = evaluate.instructions_from_payload(_payload())
    c = evaluate.instructions_from_payload(_payload(direction="A different picture of a good name."))
    assert a is not None and b is not None and c is not None
    assert evaluate.prompt_version(a) == evaluate.prompt_version(b)
    assert evaluate.prompt_version(a) != evaluate.prompt_version(c)
    assert len(evaluate.prompt_version(a)) == 12


def test_evidence_pack_is_frozen_facts():
    ins = evaluate.instructions_from_payload(_payload())
    plan = _plan()
    news = TickerNews(symbol="FLAT", red_flags=["offering"], items=[NewsItem(symbol="FLAT", headline="Company files offering")])
    pack = evaluate.evidence_pack("plan_card", ins, plan, _regime(), news)
    assert pack["plan"]["entry"] == 50.4
    assert pack["plan"]["stop"] == 47.0
    assert pack["plan"]["shares"] == 2
    assert pack["news"]["headlines"] == ["Company files offering"]
    assert pack["regime"]["sizing"] == "full"
    assert "daily" in pack["chart"]["kinds"]
    assert "suggested_stop" not in pack["plan"]
    assert "pixels" in pack["chart"]["note"]


def test_plan_card_gate_stores_template_verdict(tmp_path, cfg, monkeypatch):
    monkeypatch.delenv("GROQ_KEY", raising=False)
    monkeypatch.delenv("GEMINI_KEY", raising=False)
    db = tmp_path / "j.sqlite"
    _save_strategy(db, _payload())
    plan = _plan()
    note = evaluate.attach_plan_cards([plan], _regime(), [TickerNews(symbol="FLAT")], cfg, path=db)
    assert note is None
    assert plan.entry == 50.4 and plan.stop == 47.0 and plan.shares == 2
    assert len(plan.evaluations) == 1
    ev = plan.evaluations[0]
    assert ev.gate == "plan_card" and ev.verdict == "watch" and ev.model == "template"
    assert ev.prompt_version
    assert "not a take or a skip" in ev.reasons[0]
    journal.save_plans(date(2026, 10, 8), [plan], path=db)
    loaded = journal.plans_for(date(2026, 10, 8), path=db)
    assert loaded[0].evaluations[0].prompt_version == ev.prompt_version
    assert loaded[0].entry == 50.4


def test_rejected_and_inactive_are_not_judged(tmp_path, cfg, monkeypatch):
    monkeypatch.delenv("GROQ_KEY", raising=False)
    monkeypatch.delenv("GEMINI_KEY", raising=False)
    db = tmp_path / "j.sqlite"
    rejected = _plan(status="rejected")
    assert evaluate.attach_plan_cards([rejected], _regime(), [], cfg, path=db) is None
    assert rejected.evaluations == []

    _save_strategy(db, _payload(), status="draft")
    watch = _plan()
    note = evaluate.attach_plan_cards([watch], _regime(), [], cfg, path=db)
    assert note == "No active strategy; ticker evaluator skipped."
    assert watch.evaluations == []


def test_plan_card_gate_off_skips(tmp_path, cfg, monkeypatch):
    monkeypatch.delenv("GROQ_KEY", raising=False)
    monkeypatch.delenv("GEMINI_KEY", raising=False)
    db = tmp_path / "j.sqlite"
    _save_strategy(db, _payload(plan_card=False))
    plan = _plan()
    assert evaluate.attach_plan_cards([plan], _regime(), [], cfg, path=db) is None
    assert plan.evaluations == []


def test_alert_and_management_gates(tmp_path, cfg, monkeypatch):
    monkeypatch.delenv("GROQ_KEY", raising=False)
    monkeypatch.delenv("GEMINI_KEY", raising=False)
    db = tmp_path / "j.sqlite"
    _save_strategy(db, _payload(alert=True, management=True))
    plan = _plan()
    alert = Alert(
        ts=datetime(2026, 10, 8, 11, 0),
        symbol="FLAT",
        condition="breakout_confirmed",
        price=50.6,
        actionable=True,
        message="BUY SIGNAL FLAT",
    )
    ev = evaluate.attach_alert(plan, alert, _regime(), cfg, path=db)
    assert ev is not None and ev.gate == "actionable_alert" and ev.verdict == "watch"
    assert plan.stop == 47.0
    assert evaluate.attach_alert(plan, alert, _regime(), cfg, path=db) is None

    quiet = Alert(ts=datetime(2026, 10, 8, 11, 5), symbol="FLAT", condition="approaching", price=49.8, actionable=False)
    assert evaluate.attach_alert(_plan(), quiet, _regime(), cfg, path=db) is None

    day = date(2026, 10, 8)
    journal.save_plans(day, [_plan()], path=db)
    evaluate.attach_management(
        [ManageAction(symbol="FLAT", action="earnings_decision", reason="earnings in 2 days")],
        _regime(),
        cfg,
        path=db,
    )
    stored = journal.plan_on(day, "FLAT", path=db)
    assert stored is not None
    assert stored.evaluations[0].gate == "management"
    assert stored.entry == 50.4
    evaluate.attach_management(
        [ManageAction(symbol="FLAT", action="earnings_decision", reason="earnings in 2 days")],
        _regime(),
        cfg,
        path=db,
    )
    again = journal.plan_on(day, "FLAT", path=db)
    assert again is not None and len(again.evaluations) == 1
