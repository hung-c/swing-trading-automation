from datetime import date

from swing.llm import review_position
from swing.models import ManageAction, PlanCard, Position, RegimeReport


def _plan() -> PlanCard:
    return PlanCard(
        symbol="XOM",
        pattern="flat_base",
        resistance=100,
        entry=100.5,
        stop=94,
        risk_per_share=6.5,
        stop_pct=6.5,
        shares=7,
        fractional_shares=7.4,
        notional=700,
        target_2r=113.5,
        target_3r=120,
        atr14=2,
        stop_atr_mult=3,
        trend_score=7,
        pattern_quality=7.5,
        alert_level=100,
    )


def _pos() -> Position:
    plan = _plan()
    return Position(
        symbol="XOM",
        opened=date(2026, 10, 1),
        entry=101,
        stop=95,
        initial_stop=95,
        shares=10,
        target_2r=113,
        resistance=100,
        original_plan=plan,
    )


def test_review_uses_the_model_when_the_call_fits(monkeypatch):
    def fake(system, facts, model, cfg=None):
        return model.model_validate({"stance": "keep", "reason": "Price 104 is above the 95 stop and the base at 100 still holds."}), "groq:test"

    monkeypatch.setattr("swing.llm.judge", fake)
    action = ManageAction(symbol="XOM", action="hold", reason="desk says hold", price=104)
    stance, reason = review_position(_pos(), action, RegimeReport(as_of=date(2026, 10, 8), sizing="full"))
    assert stance == "keep"
    assert "104" in reason


def test_review_forces_exit_when_the_stop_is_through(monkeypatch):
    def fake(system, facts, model, cfg=None):
        return model.model_validate({"stance": "keep", "reason": "The model wanted to stay in."}), "groq:test"

    monkeypatch.setattr("swing.llm.judge", fake)
    action = ManageAction(symbol="XOM", action="stop_hit", reason="price 94.00 <= stop 95.00", price=94)
    stance, reason = review_position(_pos(), action, None)
    assert stance == "exit"
    assert "stop" in reason


def test_review_falls_back_to_the_desk_rule_without_a_model(monkeypatch):
    monkeypatch.setattr("swing.llm.judge", lambda *args, **kwargs: None)
    action = ManageAction(symbol="XOM", action="sell_half_2r", reason="at 2.0R - sell half", price=113, new_stop=101)
    stance, reason = review_position(_pos(), action, None)
    assert stance == "sell_half"
    assert "sell half" in reason
