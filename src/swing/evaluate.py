"""Advisory ticker judge. Runs only after a name has cleared a strategy gate.

The evidence pack is frozen facts from code. The verdict is stored on the plan and does not change
entry, stop, or size.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from swing.config import Cfg, load_config
from swing.models import Alert, ManageAction, PlanCard, RegimeReport, TickerEvaluation, TickerNews

log = logging.getLogger(__name__)

Gate = Literal["plan_card", "actionable_alert", "management"]
MAX_PLAN_CARDS = 12

SYSTEM = (
    "You judge one ticker that already cleared the hard rules of a swing strategy. "
    "You do not change entry, stop, shares, or targets. Never invent prices, dates, headlines, or catalysts. "
    "Use only the evidence JSON and the written instructions in it. "
    "If a written rule cannot be checked from the evidence, add it to open_questions and do not treat it as a failure. "
    "skip only when a disqualify rule is met by the evidence. "
    "take only when every must-pass rule that the evidence can check is met. "
    "otherwise watch. "
    "On the management gate, take means the written rules say to keep holding, and skip means they say to get out. "
    "Return ONLY a JSON object with keys: verdict (take, watch, or skip), "
    "reasons (list of at most 5 short strings, each citing a written rule), "
    "open_questions (list of at most 4 short strings)."
)


class EvaluatorInstructions(BaseModel):
    plan_card: bool = True
    actionable_alert: bool = False
    management: bool = False
    direction: str = ""
    must_pass: str = ""
    disqualify: str = ""
    do_not: str = ""

    def enabled(self, gate: Gate) -> bool:
        return bool(getattr(self, gate))


class TickerVerdictBody(BaseModel):
    verdict: Literal["take", "watch", "skip"] = "watch"
    reasons: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)

    @field_validator("reasons", "open_questions")
    @classmethod
    def _clip(cls, v: list[str]) -> list[str]:
        return [str(s).strip()[:400] for s in v if str(s).strip()][:6]


def instructions_from_payload(payload: object) -> EvaluatorInstructions | None:
    if not isinstance(payload, dict):
        return None
    ev = payload.get("evaluator")
    if not isinstance(ev, dict):
        return None
    gates = ev.get("gates") if isinstance(ev.get("gates"), dict) else {}
    return EvaluatorInstructions(
        plan_card=bool(gates.get("plan_card", True)),
        actionable_alert=bool(gates.get("actionable_alert", False)),
        management=bool(gates.get("management", False)),
        direction=str(ev.get("direction") or "")[:1200],
        must_pass=str(ev.get("must_pass") or "")[:800],
        disqualify=str(ev.get("disqualify") or "")[:800],
        do_not=str(ev.get("do_not") or "")[:800],
    )


def prompt_version(ins: EvaluatorInstructions) -> str:
    blob = json.dumps(ins.model_dump(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()[:12]


def _clip_text(s: str, n: int = 500) -> str:
    s = s.strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def evidence_pack(
    gate: Gate,
    ins: EvaluatorInstructions,
    plan: PlanCard,
    regime: RegimeReport | None,
    news: TickerNews | None = None,
    alert: Alert | None = None,
    action: ManageAction | None = None,
) -> dict:
    """Facts the model may restate. No suggested replacement for entry, stop, or size."""
    pack: dict = {
        "gate": gate,
        "instructions": {
            "direction": ins.direction,
            "must_pass": ins.must_pass,
            "disqualify": ins.disqualify,
            "do_not": ins.do_not,
        },
        "regime": None if regime is None else {"sizing": regime.sizing, "notes": list(regime.notes)[:6]},
        "plan": {
            "symbol": plan.symbol,
            "pattern": plan.pattern,
            "quality": plan.pattern_quality,
            "trend_score": plan.trend_score,
            "trend_missing": list(plan.trend_missing),
            "resistance": plan.resistance,
            "entry": plan.entry,
            "stop": plan.stop,
            "stop_pct": plan.stop_pct,
            "shares": plan.shares,
            "target_2r": plan.target_2r,
            "rs": plan.rs_rating,
            "sector": plan.sector,
            "earnings_days": plan.earnings.trading_days_away if plan.earnings else None,
            "notes": list(plan.notes)[:8],
        },
        "news": {
            "red_flags": list(news.red_flags) if news else [],
            "headlines": [i.headline for i in news.items[:8]] if news else [],
        },
        "chart": {
            "kinds": sorted(plan.chart_paths),
            "note": "Chart images are stored with the plan. This packet does not include pixels.",
        },
    }
    if alert is not None:
        pack["alert"] = {
            "condition": alert.condition,
            "price": alert.price,
            "rvol": alert.rvol,
            "vwap": alert.vwap,
            "actionable": alert.actionable,
            "message": _clip_text(alert.message),
        }
    if action is not None:
        pack["management"] = {
            "action": action.action,
            "reason": action.reason,
            "price": action.price,
            "new_stop": action.new_stop,
        }
    return pack


def template_verdict() -> TickerVerdictBody:
    return TickerVerdictBody(
        verdict="watch",
        reasons=["No model was available, so this is not a take or a skip. Entry, stop, and size are unchanged."],
        open_questions=["Set GROQ_KEY or GEMINI_KEY and run the job again to judge this name against the strategy text."],
    )


def _finish(body: TickerVerdictBody, provider: str, version: str, gate: Gate) -> TickerEvaluation:
    if body.verdict in ("take", "skip") and not body.reasons:
        body.verdict = "watch"
        body.open_questions.append("The model gave no reason, so this stays a watch.")
    return TickerEvaluation(
        verdict=body.verdict,
        reasons=body.reasons[:5],
        open_questions=body.open_questions[:4],
        model=provider,
        prompt_version=version,
        gate=gate,
    )


def judge_pack(pack: dict, cfg: Cfg | None = None) -> TickerEvaluation:
    from swing import llm

    gate: Gate = pack["gate"]
    version = ""
    judged = llm.judge(SYSTEM, pack, TickerVerdictBody, cfg)
    if judged is None:
        body, provider = template_verdict(), "template"
    else:
        body, provider = judged
    # prompt version is attached by the caller when it has the instructions; pack does not hash itself
    return _finish(body, provider, version, gate)


def _active(path=None) -> tuple[EvaluatorInstructions, str] | None:
    from swing import journal

    row = journal.active_strategy(path)
    if not row:
        return None
    ins = instructions_from_payload(row.get("payload"))
    if ins is None:
        return None
    return ins, prompt_version(ins)


def _store(plan: PlanCard, ev: TickerEvaluation) -> None:
    plan.evaluations = [e for e in plan.evaluations if e.gate != ev.gate]
    plan.evaluations.append(ev)


def judge_one(
    gate: Gate,
    ins: EvaluatorInstructions,
    version: str,
    plan: PlanCard,
    regime: RegimeReport | None,
    cfg: Cfg | None,
    news: TickerNews | None = None,
    alert: Alert | None = None,
    action: ManageAction | None = None,
) -> TickerEvaluation:
    pack = evidence_pack(gate, ins, plan, regime, news, alert, action)
    ev = judge_pack(pack, cfg)
    ev.prompt_version = version
    return ev


def attach_plan_cards(
    plans: list[PlanCard],
    regime: RegimeReport | None,
    news: list[TickerNews],
    cfg: Cfg | None = None,
    path=None,
) -> str | None:
    """Judge watch plans at the plan-card gate. Returns a warning when the gate should have run but did not."""
    if not plans:
        return None
    cfg = cfg or load_config()
    found = _active(path)
    if found is None:
        from swing import journal

        if journal.has_strategies(path):
            return "No active strategy; ticker evaluator skipped."
        return None
    ins, version = found
    if not ins.plan_card:
        return None
    by_symbol = {t.symbol: t for t in news}
    for plan in plans[:MAX_PLAN_CARDS]:
        if plan.status != "watch":
            continue
        try:
            ev = judge_one("plan_card", ins, version, plan, regime, cfg, news=by_symbol.get(plan.symbol))
        except Exception as e:  # noqa: BLE001
            log.warning("evaluate %s failed: %s", plan.symbol, str(e)[:160])
            ev = _finish(template_verdict(), "template", version, "plan_card")
        _store(plan, ev)
        log.info("evaluate %s %s via %s prompt %s", plan.symbol, ev.verdict, ev.model, ev.prompt_version)
    return None


def attach_alert(plan: PlanCard, alert: Alert, regime: RegimeReport | None, cfg: Cfg | None = None, path=None) -> TickerEvaluation | None:
    """Last look on a new actionable plan alert. None when that gate is off or already judged."""
    if not alert.actionable or alert.condition != "breakout_confirmed":
        return None
    if any(e.gate == "actionable_alert" for e in plan.evaluations):
        return None
    found = _active(path)
    if found is None:
        return None
    ins, version = found
    if not ins.actionable_alert:
        return None
    ev = judge_one("actionable_alert", ins, version, plan, regime, cfg or load_config(), alert=alert)
    _store(plan, ev)
    return ev


def attach_management(actions: list[ManageAction], regime: RegimeReport | None, cfg: Cfg | None = None, path=None) -> None:
    """Hold-or-out note on the latest plan for each management action. Skips names already judged today."""
    if not actions:
        return
    from swing import journal

    found = _active(path)
    if found is None:
        return
    ins, version = found
    if not ins.management:
        return
    day = journal.latest_plan_date(path)
    if day is None:
        return
    cfg = cfg or load_config()
    for action in actions:
        plan = journal.plan_on(day, action.symbol, path)
        if plan is None or any(e.gate == "management" for e in plan.evaluations):
            continue
        ev = judge_one("management", ins, version, plan, regime, cfg, action=action)
        _store(plan, ev)
        journal.save_plan_payload(day, plan, path)
        log.info("evaluate %s management %s via %s", plan.symbol, ev.verdict, ev.model)
