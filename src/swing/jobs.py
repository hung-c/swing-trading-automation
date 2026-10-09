"""Job orchestration: nightly (16:35 ET), premarket (07:00 ET), intraday (every 15 min 10:00-15:45 ET), report.

Each job is a plain sequence of agent calls passing Pydantic models. Every job exits early on non-trading days
unless --force. --dry-run writes nothing to the journal/DB and sends no push (local markdown only).
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from datetime import UTC, datetime, time
from pathlib import Path

from swing import charts, evaluate, journal, llm
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

# Step ids are shared with web/lib/flow.ts. Keep both lists in the same order.
NIGHTLY_STEPS = (
    "guard", "universe", "bars", "screen", "earnings", "patterns", "risk",
    "charts", "news", "regime", "evaluate", "prose", "publish",
)
PREMARKET_STEPS = ("guard", "regime", "plans", "earnings", "prose", "publish")
INTRADAY_STEPS = ("session", "plans", "prices", "alerts", "save", "manage", "eod")
REPORT_STEPS = ("report",)


class _Step:
    def __init__(self) -> None:
        self.summary: dict | None = None
        self.status: str | None = None
        self.error: str | None = None


class JobRun:
    """Writes job_runs rows. No-ops on --dry-run, and when no database is configured (guard-only exits)."""

    def __init__(self, job: str, *, dry_run: bool = False, path: Path | None = None):
        self.job = job
        self.dry_run = dry_run
        self.path = path
        self.run_id: int | None = None
        self.failed = False
        self._error: str | None = None
        self._step_id: int | None = None
        self._closed = False
        if dry_run:
            return
        if path is None and not journal.database_url():
            return
        try:
            self.run_id = journal.begin_run(job, path=path)
        except Exception as e:  # noqa: BLE001
            log.warning("could not open job run log: %s", e)

    def _quiet(self, fn):
        """Run a log write. Returns None when the write itself failed."""
        try:
            result = fn()
            return True if result is None else result
        except Exception as e:  # noqa: BLE001
            log.warning("job run log: %s", e)
            return None

    @contextmanager
    def step(self, name: str):
        box = _Step()
        if self.dry_run or self.run_id is None or self.failed:
            yield box
            return
        self._quiet(lambda: journal.note_run(self.run_id, {"current": name}, path=self.path))
        self._step_id = self._quiet(lambda: journal.record_step(self.run_id, self.job, name, "running", path=self.path))
        try:
            yield box
        except Exception as e:
            self.failed = True
            error = str(e)
            self._error = error
            sid = self._step_id
            self._step_id = None
            if sid is not None:
                self._quiet(lambda: journal.finish_step(sid, "failed", summary=box.summary, error=error, path=self.path))
            raise
        else:
            sid = self._step_id
            self._step_id = None
            status = box.status or "ok"
            if sid is not None:
                self._quiet(lambda: journal.finish_step(sid, status, summary=box.summary, error=box.error, path=self.path))

    def skip(self, *steps: str, summary: dict | None = None) -> None:
        if self.dry_run or self.run_id is None or self.failed:
            return
        for name in steps:
            self._quiet(
                lambda name=name: journal.record_step(
                    self.run_id, self.job, name, "skipped", summary=summary, path=self.path
                )
            )

    def finish(self, status: str = "ok", summary: dict | None = None, error: str | None = None) -> None:
        if self._closed or self.run_id is None:
            return
        if self.failed and status == "ok":
            status = "failed"
            error = error or self._error
        wrote = self._quiet(lambda: journal.finish_run(self.run_id, status, summary=summary, error=error, path=self.path))
        if wrote is not None:
            self._closed = True

    def fail(self, error: str) -> None:
        self.failed = True
        self._error = error
        sid = self._step_id
        self._step_id = None
        if sid is not None:
            self._quiet(lambda: journal.finish_step(sid, "failed", error=error, path=self.path))
        self.finish("failed", error=error)

    def close(self) -> None:
        if self._closed:
            return
        if self.failed:
            self.finish("failed", error=self._error)
        else:
            self.finish("ok")


def _guard(force: bool) -> bool:
    if force or is_trading_day():
        return True
    log.info("not a trading day (%s); exiting", today_et())
    return False


def _require_neon() -> None:
    journal.require()


def _publish(brief: DailyBrief, dry_run: bool) -> None:
    """The web app reads briefs from the journal DB; this is the whole 'publish' step."""
    if not dry_run:
        try:
            journal.save_brief(brief.date, brief.kind, brief.model_dump(mode="json"))
            journal.kv_set("status:" + brief.kind, {"date": brief.date.isoformat(), "at": datetime.now(UTC).isoformat(), "llm": brief.llm_provider})
        except Exception as e:  # noqa: BLE001
            log.error("saving brief to %s failed: %s", journal.backend(), e)
            brief.warnings.append(f"brief not saved: {e}")
    _write_local(brief)


def _store_charts(plans, day: str) -> None:
    """Upload chart PNGs into the journal DB (served by the web app) and point plan.chart_paths at the web route."""
    for p in plans:
        served: dict[str, str] = {}
        for kind, path in p.chart_paths.items():
            try:
                journal.save_chart(day, p.symbol, kind, Path(path).read_bytes())
                served[kind] = f"/api/chart/{day}/{p.symbol}/{kind}"
            except Exception as e:  # noqa: BLE001
                log.warning("chart upload %s/%s failed: %s", p.symbol, kind, e)
        p.chart_paths = served


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


def _rest(steps: tuple[str, ...], done: str) -> tuple[str, ...]:
    return tuple(s for s in steps if s != done)


# ---------------------------------------------------------------- nightly
def run_nightly(args) -> int:
    run = JobRun("nightly", dry_run=args.dry_run)
    try:
        if not _guard(args.force):
            reason = {"reason": "not a trading day"}
            with run.step("guard") as st:
                st.status = "skipped"
                st.summary = reason
            run.skip(*_rest(NIGHTLY_STEPS, "guard"), summary=reason)
            run.finish("skipped", reason)
            return 0
        with run.step("guard") as st:
            st.summary = {"trading_day": True}
        _require_neon()
        cfg = load_config()
        ensure_dirs(cfg)
        session = last_completed_session() if not args.force else today_et()
        log.info("nightly for session %s journal=%s dry_run=%s", session, journal.backend(), args.dry_run)

        with run.step("universe") as st:
            uni = universe.build(limit=args.limit)
            meta = universe.meta_by_symbol(uni)
            st.summary = {"symbols": int(len(uni))}
        with run.step("bars") as st:
            frames, provider = bars.daily(uni["symbol"].tolist(), years=3.0, end=session)
            warnings = [] if provider == "alpaca" else [f"bars from fallback provider '{provider}' (set ALPACA_KEY/SECRET for SIP data)"]
            st.summary = {"provider": provider, "symbols": len(frames)}
        with run.step("screen") as st:
            out = screener.screen(frames, meta, {}, cfg)
            st.summary = {"strict": int(out.strict_count), "rows": len(out.rows), "ladder": int(out.ladder_step)}
        with run.step("earnings") as st:
            earn = earnings.upcoming([r.symbol for r in out.rows], session)
            out = screener.apply_earnings(out, earn)
            st.summary = {"excluded": len(out.excluded_earnings)}
        with run.step("patterns") as st:
            kept, dropped = pattern.run(out.rows, frames, cfg)
            st.summary = {"kept": len(kept), "dropped": len(dropped)}
        with run.step("risk") as st:
            positions = journal.open_positions()
            watch, rejected = risk.run(kept, positions, cfg)
            for c in dropped:
                log.debug("dropped %s: %s", c.row.symbol, c.dropped_reason)
            st.summary = {"plans": len(watch), "rejected": len(rejected)}

        day = session.isoformat()
        with run.step("charts") as st:
            intra_syms = [p.symbol for p in watch][:10]
            intra, _ = bars.intraday(intra_syms, cfg.charts.intraday_interval_min, cfg.charts.intraday_days, feed="sip") if intra_syms else ({}, "")
            for p in watch:
                p.chart_paths = charts.charts_for_plan(p, frames[p.symbol], day, intra.get(p.symbol))
            st.summary = {"plans": len(watch)}
        with run.step("news") as st:
            news_syms = [p.symbol for p in watch] + [p.symbol for p in positions if p.symbol not in {w.symbol for w in watch}]
            tnews = news.run(news_syms, sentiment_symbols=[p.symbol for p in watch], cfg=cfg) if news_syms else []
            for t in tnews:
                if t.red_flags:
                    for p in watch:
                        if p.symbol == t.symbol:
                            p.notes.append("news red flags: " + ", ".join(t.red_flags))
            st.summary = {"symbols": len(tnews)}
        with run.step("regime") as st:
            reg = regime.run(session, frames, cfg)
            pos_earn = earnings.upcoming([p.symbol for p in positions], session, confirm_with_yf=True) if positions else {}
            actions = manage.run(positions, frames, {}, pos_earn, cfg) if positions else []
            st.summary = {"sizing": reg.sizing, "manage": len(actions)}
        with run.step("evaluate") as st:
            note = evaluate.attach_plan_cards(watch, reg, tnews, cfg)
            if note:
                warnings.append(note)
            st.summary = {"plans": len(watch)}
        with run.step("prose") as st:
            brief = DailyBrief(
                date=session, kind="nightly", regime=reg,
                screen_count_strict=out.strict_count, screen_count_final=len(out.rows) + len(out.excluded_earnings),
                ladder_step_used=out.ladder_step, weekly_survivors=len(kept) + sum(1 for c in dropped if not c.dropped_reason.startswith("weekly")),
                plans=watch, rejected=rejected, news=tnews, positions=positions, manage=actions,
                heat_pct=journal.heat_pct(cfg.account.size_usd, positions), warnings=warnings,
            )
            brief.prose, brief.llm_provider = llm.write(brief, cfg)
            st.summary = {"llm": brief.llm_provider}
        with run.step("publish") as st:
            if not args.dry_run:
                _store_charts(watch, day)
                journal.save_plans(session, watch + rejected)
                journal.kv_set(f"regime:{session.isoformat()}", reg.model_dump(mode="json"))
                journal.prune()
            _publish(brief, args.dry_run)
            if not args.dry_run:
                telegram.push_nightly(brief)
            st.summary = {"plans": len(watch), "pushed": not args.dry_run}
        summary = {
            "session": session.isoformat(),
            "strict": int(out.strict_count),
            "plans": len(watch),
            "rejected": len(rejected),
            "llm": brief.llm_provider,
        }
        run.finish("ok", summary)
        print(f"nightly {session}: screen {out.strict_count} strict / {len(out.rows)} final (ladder {out.ladder_step}), "
              f"{len(kept)} candidates, {len(watch)} plans, {len(rejected)} rejected; sizing {reg.sizing}; llm {brief.llm_provider}")
        for p in watch:
            print(p.card_text(), "\n")
        return 0
    except BaseException as e:
        run.fail(str(e))
        raise
    finally:
        run.close()


# ---------------------------------------------------------------- premarket
def run_premarket(args) -> int:
    run = JobRun("premarket", dry_run=args.dry_run)
    try:
        if not _guard(args.force):
            reason = {"reason": "not a trading day"}
            with run.step("guard") as st:
                st.status = "skipped"
                st.summary = reason
            run.skip(*_rest(PREMARKET_STEPS, "guard"), summary=reason)
            run.finish("skipped", reason)
            return 0
        with run.step("guard") as st:
            st.summary = {"trading_day": True}
        _require_neon()
        cfg = load_config()
        ensure_dirs(cfg)
        today = today_et()
        with run.step("regime") as st:
            reg = regime.run(today, None, cfg)
            st.summary = {"sizing": reg.sizing, "max_new": reg.max_new_positions}
        with run.step("plans") as st:
            positions = journal.open_positions()
            plans = journal.latest_plans("watch")
            st.summary = {"plans": len(plans), "positions": len(positions)}
        with run.step("earnings") as st:
            pos_earn = earnings.upcoming([p.symbol for p in positions], today) if positions else {}
            warn = [f"{s}: earnings in {e.trading_days_away} trading days" for s, e in pos_earn.items() if e.trading_days_away is not None and e.trading_days_away <= cfg.manage.earnings_decision_days]
            st.summary = {"warnings": len(warn)}
        with run.step("prose") as st:
            brief = DailyBrief(date=today, kind="premarket", regime=reg, plans=plans, positions=positions, heat_pct=journal.heat_pct(cfg.account.size_usd, positions), warnings=warn)
            brief.prose, brief.llm_provider = llm.write(brief, cfg)
            st.summary = {"llm": brief.llm_provider}
        with run.step("publish") as st:
            if not args.dry_run:
                journal.kv_set(f"regime:{today.isoformat()}", reg.model_dump(mode="json"))
            _publish(brief, args.dry_run)
            st.summary = {"plans": len(plans)}
        run.finish("ok", {"sizing": reg.sizing, "plans": len(plans), "llm": brief.llm_provider})
        print(f"premarket {today}: sizing {reg.sizing} (max new {reg.max_new_positions}); {len(plans)} plans armed; notes: {reg.notes}")
        return 0
    except BaseException as e:
        run.fail(str(e))
        raise
    finally:
        run.close()


# ---------------------------------------------------------------- intraday
def _today_regime() -> RegimeReport | None:
    raw = journal.kv_get(f"regime:{today_et().isoformat()}")
    return RegimeReport.model_validate(raw) if raw else None


def run_intraday(args) -> int:
    run = JobRun("intraday", dry_run=args.dry_run)
    try:
        cfg = load_config()
        it = cfg.intraday
        now = now_et()
        # from_tick: the 15-minute tick already decided this run is inside the strategy window.
        if not args.force and not getattr(args, "from_tick", False) and not in_session_window(it.session_start, it.session_end, now):
            log.info("outside %s-%s ET session window or non-trading day; exiting", it.session_start, it.session_end)
            reason = {"reason": "outside session window"}
            with run.step("session") as st:
                st.status = "skipped"
                st.summary = reason
            run.skip(*_rest(INTRADAY_STEPS, "session"), summary=reason)
            run.finish("skipped", reason)
            return 0
        with run.step("session") as st:
            st.summary = {"at": now.isoformat()}
        _require_neon()
        ensure_dirs(cfg)
        with run.step("plans") as st:
            plans = journal.latest_plans("watch")
            positions = journal.open_positions()
            symbols = sorted({p.symbol for p in plans} | {p.symbol for p in positions})
            st.summary = {"plans": len(plans), "positions": len(positions)}
        if not symbols:
            log.info("no plans or positions; nothing to watch")
            reason = {"reason": "no plans or positions"}
            run.skip("prices", "alerts", "save", "manage", "eod", summary=reason)
            run.finish("skipped", reason)
            return 0
        reg = _today_regime() or regime.run(today_et(), None, cfg)
        with run.step("prices") as st:
            prices = bars.latest(symbols)
            intra, _prov = bars.intraday(symbols, 5, it.rvol_baseline_sessions + 3, feed="sip")
            yday = {}
            daily, _ = bars.daily(symbols, years=0.3, end=prev_trading_day())
            for s, df in daily.items():
                if not df.empty:
                    yday[s] = float(df["close"].iloc[-1])
            st.summary = {"symbols": len(symbols), "priced": sum(1 for v in prices.values() if v)}
        with run.step("alerts") as st:
            found = alerts.run(plans, positions, prices, yday, intra, reg, now, cfg)
            st.summary = {"found": len(found)}
        with run.step("save") as st:
            if args.dry_run:
                new = found
            else:
                new = journal.save_alerts(found)
                journal.kv_set("prices", {"at": now.isoformat(), "prices": {s: float(v) for s, v in prices.items() if v}})
            for a in new:
                print(f"{a.ts:%H:%M} {a.symbol} {a.condition}{' *' if a.actionable else ''}: {a.message}")
                matched = next((p for p in plans if p.symbol == a.symbol), None)
                if matched and not args.dry_run:
                    ev = evaluate.attach_alert(matched, a, reg, cfg)
                    pd_ = journal.latest_plan_date()
                    if ev and pd_:
                        journal.save_plan_payload(pd_, matched)
                if a.condition == "breakout_confirmed" and not args.dry_run:
                    pd_ = journal.latest_plan_date()
                    if pd_:
                        journal.update_plan_status(pd_, a.symbol, "triggered")
            if new and not args.dry_run:
                telegram.push_alerts(new)
            st.summary = {"new": len(new)}

        close = close_time_et(now.date()) or time(16, 0)
        manage_window = (now.hour, now.minute) >= (close.hour, max(close.minute - 20, 0)) if close else False
        if args.manage or manage_window:
            with run.step("manage") as st:
                frames_full, _ = bars.daily([p.symbol for p in positions], years=1.0) if positions else ({}, "")
                pos_earn = earnings.upcoming([p.symbol for p in positions], today_et()) if positions else {}
                actions = manage.run(positions, frames_full, prices, pos_earn, cfg) if positions else []
                if not args.dry_run:
                    evaluate.attach_management(actions, reg, cfg)
                st.summary = {"actions": len(actions)}
            with run.step("eod") as st:
                brief = DailyBrief(date=today_et(), kind="eod", regime=reg, positions=positions, manage=actions, alerts=new, heat_pct=journal.heat_pct(cfg.account.size_usd, positions))
                brief.prose, brief.llm_provider = llm.write(brief, cfg)
                _publish(brief, args.dry_run)
                for m in actions:
                    print(f"MANAGE {m.symbol}: {m.action} - {m.reason}")
                st.summary = {"actions": len(actions), "llm": brief.llm_provider}
        else:
            run.skip("manage", "eod", summary={"reason": "not the closing window"})
        run.finish("ok", {"alerts": len(new)})
        return 0
    except BaseException as e:
        run.fail(str(e))
        raise
    finally:
        run.close()


# ---------------------------------------------------------------- weekly report
def run_report(args) -> int:
    from swing.extras.report import build_report

    run = JobRun("report", dry_run=getattr(args, "dry_run", False))
    try:
        _require_neon()
        cfg = load_config()
        with run.step(REPORT_STEPS[0]) as st:
            text = build_report(cfg)
            st.summary = {"chars": len(text)}
        print(text)
        run.finish("ok", {"chars": len(text)})
        return 0
    except BaseException as e:
        run.fail(str(e))
        raise
    finally:
        run.close()
