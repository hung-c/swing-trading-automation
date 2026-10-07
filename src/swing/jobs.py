"""Job orchestration: nightly (16:35 ET), premarket (07:00 ET), intraday (every 15 min 10:00-15:45 ET), report.

Each job is a plain sequence of agent calls passing Pydantic models. Every job exits early on non-trading days
unless --force. --dry-run skips Notion.
"""

from __future__ import annotations

import logging
from datetime import time

from swing import charts, journal, llm
from swing import notion_publisher as notion
from swing.agents import alerts, manage, news, pattern, regime, risk, screener, universe
from swing.calendars import (
    close_time_et,
    in_session_window,
    is_trading_day,
    last_completed_session,
    now_et,
    prev_trading_day,
    today_et,
)
from swing.config import ensure_dirs, load_config
from swing.data import bars, earnings
from swing.extras import telegram
from swing.models import DailyBrief, RegimeReport

log = logging.getLogger(__name__)


def _guard(force: bool) -> bool:
    if force or is_trading_day():
        return True
    log.info("not a trading day (%s); exiting", today_et())
    return False


def _publish(brief: DailyBrief, dry_run: bool, upload_charts: bool = True) -> str | None:
    pid = None
    if not dry_run and notion.available():
        try:
            pid = notion.publish_brief(brief, upload_charts=upload_charts)
        except Exception as e:  # noqa: BLE001
            log.error("notion publish failed: %s", e)
            brief.warnings.append(f"Notion publish failed: {e}")
    elif not dry_run:
        log.warning("Notion not configured; brief kept locally only")
    journal.save_brief(brief.date, brief.kind, pid, brief.model_dump(mode="json"))
    _write_local(brief)
    return pid


def _write_local(brief: DailyBrief) -> None:
    cfg = load_config()
    d = ensure_dirs(cfg)["out_dir"]
    p = d / f"{brief.date.isoformat()}_{brief.kind}.md"
    pr = brief.prose
    lines = [f"# {pr.headline if pr else brief.kind}", ""]
    if pr:
        lines += [pr.market_summary, "", "## Watchlist", pr.watchlist_commentary, "", "## Risk", pr.risk_notes, "", "## Checklist"] + [f"- [ ] {x}" for x in pr.tomorrow_checklist]
    if brief.regime:
        lines += ["", "## Regime", "```", brief.regime.model_dump_json(indent=1, exclude={"macro_week"}), "```"]
    if brief.plans:
        lines += ["", "## Plan cards", ""] + [f"```\n{pl.card_text()}\n```" for pl in brief.plans]
    if brief.alerts:
        lines += ["", "## Alerts"] + [f"- {a.ts:%H:%M} {a.symbol} {a.condition}: {a.message}" for a in brief.alerts]
    if brief.manage:
        lines += ["", "## Manage"] + [f"- {m.symbol}: {m.action} - {m.reason}" for m in brief.manage]
    lines += ["", f"Finviz parity: {screener.finviz_url()}"]
    p.write_text("\n".join(lines), encoding="utf-8")
    log.info("local brief -> %s", p)


# ---------------------------------------------------------------- nightly
def run_nightly(args) -> int:
    if not _guard(args.force):
        return 0
    cfg = load_config()
    ensure_dirs(cfg)
    session = last_completed_session() if not args.force else today_et()
    log.info("nightly for session %s", session)

    uni = universe.build(limit=args.limit)
    meta = universe.meta_by_symbol(uni)
    frames, provider = bars.daily(uni["symbol"].tolist(), years=3.0, end=session)
    warnings = [] if provider == "alpaca" else [f"bars from fallback provider '{provider}' (set ALPACA_KEY/SECRET for SIP data)"]

    out = screener.screen(frames, meta, {}, cfg)
    earn = earnings.upcoming([r.symbol for r in out.rows], session)
    out = screener.apply_earnings(out, earn)

    kept, dropped = pattern.run(out.rows, frames, cfg)
    positions = journal.open_positions()
    watch, rejected = risk.run(kept, positions, cfg)
    for c in dropped:
        log.debug("dropped %s: %s", c.row.symbol, c.dropped_reason)

    # charts (weekly/daily; 15-min if intraday bars available)
    day = session.isoformat()
    intra_syms = [p.symbol for p in watch][:10]
    intra, _ = bars.intraday(intra_syms, cfg.charts.intraday_interval_min, cfg.charts.intraday_days, feed="sip") if intra_syms else ({}, "")
    for p in watch:
        p.chart_paths = charts.charts_for_plan(p, frames[p.symbol], day, intra.get(p.symbol))

    # news for watchlist + open positions; sentiment budget on the best setups first
    news_syms = [p.symbol for p in watch] + [p.symbol for p in positions if p.symbol not in {w.symbol for w in watch}]
    tnews = news.run(news_syms, sentiment_symbols=[p.symbol for p in watch], cfg=cfg) if news_syms else []
    for t in tnews:
        if t.red_flags:
            for p in watch:
                if p.symbol == t.symbol:
                    p.notes.append("news red flags: " + ", ".join(t.red_flags))

    # regime with breadth from the universe we just downloaded; EOD management for open positions
    reg = regime.run(session, frames, cfg)
    pos_earn = earnings.upcoming([p.symbol for p in positions], session, confirm_with_yf=True) if positions else {}
    actions = manage.run(positions, frames, {}, pos_earn, cfg) if positions else []

    brief = DailyBrief(
        date=session, kind="nightly", regime=reg,
        screen_count_strict=out.strict_count, screen_count_final=len(out.rows) + len(out.excluded_earnings),
        ladder_step_used=out.ladder_step, weekly_survivors=len(kept) + sum(1 for c in dropped if not c.dropped_reason.startswith("weekly")),
        plans=watch, rejected=rejected, news=tnews, positions=positions, manage=actions,
        heat_pct=journal.heat_pct(cfg.account.size_usd, positions), warnings=warnings,
    )
    brief.prose, brief.llm_provider = llm.write(brief, cfg)

    journal.save_plans(session, watch + rejected)
    journal.kv_set(f"regime:{session.isoformat()}", reg.model_dump(mode="json"))
    _publish(brief, args.dry_run)
    if not args.dry_run:
        telegram.push_nightly(brief)
    if not args.dry_run and notion.available():
        try:
            notion.upsert_plans(watch + rejected, session)
            notion.upsert_positions(positions)
        except Exception as e:  # noqa: BLE001
            log.error("notion mirror failed: %s", e)
    print(f"nightly {session}: screen {out.strict_count} strict / {len(out.rows)} final (ladder {out.ladder_step}), "
          f"{len(kept)} candidates, {len(watch)} plans, {len(rejected)} rejected; sizing {reg.sizing}; llm {brief.llm_provider}")
    for p in watch:
        print(p.card_text(), "\n")
    return 0


# ---------------------------------------------------------------- premarket
def run_premarket(args) -> int:
    if not _guard(args.force):
        return 0
    cfg = load_config()
    ensure_dirs(cfg)
    today = today_et()
    reg = regime.run(today, None, cfg)
    positions = journal.open_positions()
    plans = journal.latest_plans("watch")
    pos_earn = earnings.upcoming([p.symbol for p in positions], today) if positions else {}
    warn = [f"{s}: earnings in {e.trading_days_away} trading days" for s, e in pos_earn.items() if e.trading_days_away is not None and e.trading_days_away <= cfg.manage.earnings_decision_days]
    brief = DailyBrief(date=today, kind="premarket", regime=reg, plans=plans, positions=positions, heat_pct=journal.heat_pct(cfg.account.size_usd, positions), warnings=warn)
    brief.prose, brief.llm_provider = llm.write(brief, cfg)
    journal.kv_set(f"regime:{today.isoformat()}", reg.model_dump(mode="json"))
    _publish(brief, args.dry_run, upload_charts=False)
    print(f"premarket {today}: sizing {reg.sizing} (max new {reg.max_new_positions}); {len(plans)} plans armed; notes: {reg.notes}")
    return 0


# ---------------------------------------------------------------- intraday
def _today_regime() -> RegimeReport | None:
    raw = journal.kv_get(f"regime:{today_et().isoformat()}")
    return RegimeReport.model_validate(raw) if raw else None


def run_intraday(args) -> int:
    cfg = load_config()
    it = cfg.intraday
    now = now_et()
    if not args.force and not in_session_window(it.session_start, it.session_end, now):
        log.info("outside %s-%s ET session window or non-trading day; exiting", it.session_start, it.session_end)
        return 0
    ensure_dirs(cfg)
    plans = journal.latest_plans("watch")
    positions = journal.open_positions()
    symbols = sorted({p.symbol for p in plans} | {p.symbol for p in positions})
    if not symbols:
        log.info("no plans or positions; nothing to watch")
        return 0
    reg = _today_regime() or regime.run(today_et(), None, cfg)
    prices = bars.latest(symbols)
    intra, prov = bars.intraday(symbols, 5, it.rvol_baseline_sessions + 3, feed="sip")
    yday = {}
    daily, _ = bars.daily(symbols, years=0.3, end=prev_trading_day())
    for s, df in daily.items():
        if not df.empty:
            yday[s] = float(df["close"].iloc[-1])
    found = alerts.run(plans, positions, prices, yday, intra, reg, now, cfg)
    new = journal.save_alerts(found)
    for a in new:
        print(f"{a.ts:%H:%M} {a.symbol} {a.condition}{' *' if a.actionable else ''}: {a.message}")
        if a.condition == "breakout_confirmed":
            journal.update_plan_status(_latest_plan_date(), a.symbol, "triggered")
    if new and not args.dry_run:
        telegram.push_alerts(new)
        if notion.available():
            try:
                notion.append_alerts(new)
            except Exception as e:  # noqa: BLE001
                log.error("notion alerts failed: %s", e)

    close = close_time_et(now.date()) or time(16, 0)
    manage_window = (now.hour, now.minute) >= (close.hour, max(close.minute - 20, 0)) if close else False
    if args.manage or manage_window:
        frames_full, _ = bars.daily([p.symbol for p in positions], years=1.0) if positions else ({}, "")
        pos_earn = earnings.upcoming([p.symbol for p in positions], today_et()) if positions else {}
        actions = manage.run(positions, frames_full, prices, pos_earn, cfg) if positions else []
        brief = DailyBrief(date=today_et(), kind="eod", regime=reg, positions=positions, manage=actions, alerts=new, heat_pct=journal.heat_pct(cfg.account.size_usd, positions))
        brief.prose, brief.llm_provider = llm.write(brief, cfg)
        _publish(brief, args.dry_run, upload_charts=False)
        for m in actions:
            print(f"MANAGE {m.symbol}: {m.action} - {m.reason}")
    return 0


def _latest_plan_date():
    from datetime import date

    with journal.connect() as con:
        r = con.execute("SELECT MAX(plan_date) d FROM plans").fetchone()
    return date.fromisoformat(r["d"]) if r and r["d"] else today_et()


# ---------------------------------------------------------------- weekly report
def run_report(args) -> int:
    from swing.extras.report import build_report

    cfg = load_config()
    text = build_report(cfg)
    print(text)
    if not args.dry_run and notion.available():
        from datetime import date

        brief = DailyBrief(date=today_et(), kind="eod")
        brief.prose = llm.BriefProse(headline=f"Weekly performance report {date.today().isoformat()}", market_summary=text[:1500], watchlist_commentary="", risk_notes="", tomorrow_checklist=[])
        brief.kind = "eod"
        _publish(brief, False, upload_charts=False)
    return 0
