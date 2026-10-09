"""BriefWriter: one LLM call turns the structured DailyBrief into prose. Groq -> Gemini -> template.

The model never sees a request to compute anything; all numbers come from the Pydantic data and the output is
validated as BriefProse (lengths capped). If anything fails, the template writer produces the brief.
"""

from __future__ import annotations

import json
import logging

from pydantic import BaseModel, ValidationError

from swing.config import Cfg, env, load_config
from swing.models import BriefProse, DailyBrief

log = logging.getLogger(__name__)

SYSTEM = (
    "You are the assistant of a disciplined breakout swing trader following a written rulebook. "
    "Write in plain English, concise, no hype, no emojis. Never invent prices, dates or numbers: only restate what is in the data. "
    "Never recommend buying anything that is marked rejected or when sizing is 'none'. "
    "Return ONLY a JSON object with keys: headline (<=120 chars), market_summary (<=900 chars), "
    "watchlist_commentary (<=1800 chars), risk_notes (<=800 chars), tomorrow_checklist (list of <=8 short strings)."
)


def _facts(brief: DailyBrief) -> dict:
    r = brief.regime
    return {
        "date": brief.date.isoformat(),
        "kind": brief.kind,
        "regime": None
        if not r
        else {
            "sizing": r.sizing,
            "max_new_positions": r.max_new_positions,
            "spy_above_50_200": [r.spy_above_50, r.spy_above_200],
            "qqq_above_50_200": [r.qqq_above_50, r.qqq_above_200],
            "futures_pct": {"ES": r.es_pct, "NQ": r.nq_pct},
            "distribution_days": {d.symbol: d.distribution_days for d in r.distribution},
            "breadth_pct_above_200": r.breadth_pct_above_200,
            "faber_risk_on": r.faber_risk_on,
            "macro_today": [f"{e.name} {e.time_et}" for e in r.macro_today],
            "no_new_entries_before": r.no_new_entries_before,
            "no_new_entries_after": r.no_new_entries_after,
            "notes": r.notes,
        },
        "screen": {"strict": brief.screen_count_strict, "final": brief.screen_count_final, "ladder_step": brief.ladder_step_used, "weekly_survivors": brief.weekly_survivors},
        "plans": [
            {
                "symbol": p.symbol, "pattern": p.pattern, "quality": p.pattern_quality, "trend_score": p.trend_score,
                "missing": p.trend_missing, "resistance": p.resistance, "entry": p.entry, "stop": p.stop, "stop_pct": p.stop_pct,
                "shares": p.shares, "target_2r": p.target_2r, "rs": p.rs_rating, "sector": p.sector,
                "earnings_days": p.earnings.trading_days_away if p.earnings else None, "notes": p.notes,
                "evaluations": [{"gate": e.gate, "verdict": e.verdict, "reasons": e.reasons[:3]} for e in p.evaluations],
            }
            for p in brief.plans
        ],
        "rejected": [{"symbol": p.symbol, "reason": p.rejected_reason} for p in brief.rejected[:10]],
        "news": [{"symbol": t.symbol, "avg_sentiment": t.avg_sentiment, "red_flags": t.red_flags, "headlines": [i.headline for i in t.items[:5]]} for t in brief.news],
        "positions": [{"symbol": p.symbol, "entry": p.entry, "stop": p.stop, "target_2r": p.target_2r, "half_sold": p.half_sold} for p in brief.positions],
        "manage": [{"symbol": m.symbol, "action": m.action, "reason": m.reason} for m in brief.manage],
        "alerts": [{"symbol": a.symbol, "condition": a.condition, "price": a.price, "actionable": a.actionable} for a in brief.alerts[:20]],
        "heat_pct": brief.heat_pct,
        "warnings": brief.warnings,
    }


def _pick_model(client, preferred: list[str]) -> str:
    """First preferred model that the provider's live /models list actually offers (models get retired often)."""
    try:
        available = {m.id.removeprefix("models/") for m in client.models.list().data}
    except Exception as e:  # noqa: BLE001
        log.debug("models.list failed (%s); using first preference", str(e)[:80])
        return preferred[0]
    for m in preferred:
        if m in available:
            return m
    raise RuntimeError(f"none of {preferred} available; provider offers {sorted(available)[:12]}...")


def _chat_json(base_url: str, api_key: str, preferred: list[str], system: str, facts: dict, max_tokens: int) -> tuple[dict, str]:
    from openai import OpenAI

    from swing.data.usage import note, provider_for_url

    client = OpenAI(base_url=base_url, api_key=api_key, timeout=60)
    pid = provider_for_url(base_url)
    if pid:
        note(pid)
    model = _pick_model(client, preferred)
    log.info("LLM model: %s", model)
    if pid:
        note(pid)
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": json.dumps(facts, default=str)}],
        temperature=0.3,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )
    txt = resp.choices[0].message.content or "{}"
    data = json.loads(txt)
    if not isinstance(data, dict):
        raise json.JSONDecodeError("object required", txt, 0)
    return data, model


def _openai_compatible(base_url: str, api_key: str, preferred: list[str], facts: dict, max_tokens: int) -> BriefProse:
    data, _model = _chat_json(base_url, api_key, preferred, SYSTEM, facts, max_tokens)
    if isinstance(data.get("tomorrow_checklist"), str):
        data["tomorrow_checklist"] = [data["tomorrow_checklist"]]
    return BriefProse.model_validate(data)


def judge[T: BaseModel](system: str, facts: dict, model: type[T], cfg: Cfg | None = None) -> tuple[T, str] | None:
    """Groq, then Gemini. None when no provider returns valid JSON. Does not use the brief template."""
    cfg = cfg or load_config()
    for provider in cfg.llm.provider_order:
        try:
            groq_key = env("GROQ_KEY")
            gemini_key = env("GEMINI_KEY")
            if provider == "groq" and groq_key:
                data, name = _chat_json("https://api.groq.com/openai/v1", groq_key, list(cfg.llm.groq_models), system, facts, cfg.llm.max_output_tokens)
                return model.model_validate(data), f"groq:{name}"
            if provider == "gemini" and gemini_key:
                data, name = _chat_json(
                    "https://generativelanguage.googleapis.com/v1beta/openai/",
                    gemini_key,
                    list(cfg.llm.gemini_models),
                    system,
                    facts,
                    cfg.llm.max_output_tokens,
                )
                return model.model_validate(data), f"gemini:{name}"
            if provider == "template":
                return None
        except (ValidationError, json.JSONDecodeError) as e:
            log.warning("LLM %s returned invalid judge JSON: %s", provider, str(e)[:200])
        except Exception as e:  # noqa: BLE001
            log.warning("LLM %s failed: %s", provider, str(e)[:200])
    return None


def template(brief: DailyBrief) -> BriefProse:
    r = brief.regime
    if r:
        ms = f"Sizing today: {r.sizing.upper()}" + (f" (max {r.max_new_positions} new)" if r.max_new_positions is not None else "") + ". " + " ".join(r.notes[:4])
    else:
        ms = "Regime not evaluated in this run."
    wl = []
    for p in brief.plans[:8]:
        wl.append(f"{p.symbol}: {p.pattern.replace('_', ' ')} q{p.pattern_quality:.1f} trend {p.trend_score}/8 - buy >{p.entry:.2f}, stop {p.stop:.2f} ({p.stop_pct:.1f}%), {p.shares} sh, 2R {p.target_2r:.2f}.")
    if not wl:
        wl.append("No qualifying setups tonight. Most nights are no-trade nights; that is the strategy working.")
    risk = []
    if brief.heat_pct is not None:
        risk.append(f"Open heat {brief.heat_pct:.1f}% of the 6% cap.")
    for m in brief.manage:
        risk.append(f"{m.symbol}: {m.action.replace('_', ' ')} - {m.reason}")
    for p in brief.rejected[:5]:
        risk.append(f"{p.symbol} rejected: {p.rejected_reason}.")
    checklist = [
        "07:00 read regime; confirm sizing and any macro blackout window",
        "09:30-10:00 do nothing; confirm alerts are armed",
        "Enter only at resistance +0.5-1% with RVOL>1.5, above VWAP and yesterday's close",
        "Place the stop in the same minute as the entry; never widen it",
        "15:45 manage: close back inside base -> exit; 2R -> sell half, stop to breakeven",
    ]
    return BriefProse(
        headline=f"{brief.kind.title()} brief {brief.date.isoformat()}: {len(brief.plans)} setups, sizing {r.sizing if r else 'n/a'}",
        market_summary=ms[:1500],
        watchlist_commentary=" ".join(wl)[:2500],
        risk_notes=(" ".join(risk) or "No open positions.")[:1200],
        tomorrow_checklist=checklist,
    )


def write(brief: DailyBrief, cfg: Cfg | None = None) -> tuple[BriefProse, str]:
    cfg = cfg or load_config()
    facts = _facts(brief)
    for provider in cfg.llm.provider_order:
        try:
            if provider == "groq" and env("GROQ_KEY"):
                return _openai_compatible("https://api.groq.com/openai/v1", env("GROQ_KEY"), list(cfg.llm.groq_models), facts, cfg.llm.max_output_tokens), "groq"
            if provider == "gemini" and env("GEMINI_KEY"):
                return _openai_compatible("https://generativelanguage.googleapis.com/v1beta/openai/", env("GEMINI_KEY"), list(cfg.llm.gemini_models), facts, cfg.llm.max_output_tokens), "gemini"
            if provider == "template":
                return template(brief), "template"
        except (ValidationError, json.JSONDecodeError) as e:
            log.warning("LLM %s returned invalid brief JSON: %s", provider, str(e)[:200])
        except Exception as e:  # noqa: BLE001
            log.warning("LLM %s failed: %s", provider, str(e)[:200])
    return template(brief), "template"
