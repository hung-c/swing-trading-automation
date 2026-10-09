"""Entry points: `swing tick | nightly | premarket | intraday | report | db-init | check`."""

from __future__ import annotations

import argparse
import logging
import sys

from swing import __version__
from swing.config import ensure_dirs, has_env, load_config


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("yfinance").setLevel(logging.WARNING)
    logging.getLogger("peewee").setLevel(logging.WARNING)


def cmd_check(args: argparse.Namespace) -> int:
    """Smoke test: config loads, calendar works, which secrets are present."""
    from swing.calendars import close_time_et, is_trading_day, next_trading_days, now_et

    cfg = load_config()
    ensure_dirs(cfg)
    print(f"swing {__version__}")
    print(f"now ET: {now_et():%Y-%m-%d %H:%M} trading_day={is_trading_day()} close={close_time_et()}")
    print(f"next 3 sessions: {[d.isoformat() for d in next_trading_days(3)]}")
    print(f"screener: price>{cfg.screener.price_min} cap>{cfg.screener.market_cap_min:,.0f} avgvol>{cfg.screener.avg_volume_min:,}")
    secrets = {
        "alpaca": has_env("ALPACA_KEY", "ALPACA_SECRET"),
        "finnhub": has_env("FINNHUB_KEY"),
        "alphavantage": has_env("ALPHAVANTAGE_KEY"),
        "groq": has_env("GROQ_KEY"),
        "gemini": has_env("GEMINI_KEY"),
        "database": has_env("DATABASE_URL"),
        "massive": has_env("MASSIVE_KEY"),
        "telegram": has_env("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"),
    }
    for k, v in secrets.items():
        print(f"  secret {k:12s} {'OK' if v else 'missing'}")
    return 0


def cmd_db_init(args: argparse.Namespace) -> int:
    from swing import journal

    with journal.connect() as db:
        n = db.one("SELECT COUNT(*) AS n FROM plans")["n"]
    print(f"journal backend: {journal.backend()} (plans rows: {n})")
    return 0


def cmd_db_push(args: argparse.Namespace) -> int:
    """Copy local state/journal.sqlite into Neon (use after a sqlite nightly)."""
    from swing import journal

    counts = journal.push_sqlite()
    print(f"pushed sqlite -> {journal.backend()}: {counts}")
    return 0


def cmd_should_run(args: argparse.Namespace) -> int:
    """Print 'true'/'false' for the scheduler: trading day, early-close handling, session window."""
    from swing.calendars import close_time_et, in_session_window, is_early_close, is_trading_day, now_et

    cfg = load_config()
    now = now_et()
    ok = is_trading_day(now.date())
    if ok and args.job == "nightly":
        close = close_time_et(now.date())
        # run at the first cron after the close: 13:xx on early-close days, 16:xx otherwise
        if is_early_close(now.date()):
            ok = now.hour == close.hour
        else:
            ok = now.hour >= 16
    elif ok and args.job == "premarket":
        ok = now.hour == 7
    elif ok and args.job == "intraday":
        ok = in_session_window(cfg.intraday.session_start, cfg.intraday.session_end, now)
    print("true" if ok else "false")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="swing")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("check", help="config/calendar/secrets smoke test").set_defaults(fn=cmd_check)

    sp = sub.add_parser("should-run", help="scheduler guard: prints true/false")
    sp.add_argument("job", choices=["nightly", "premarket", "intraday"])
    sp.set_defaults(fn=cmd_should_run)

    sp = sub.add_parser("nightly", help="16:35 ET: screen -> patterns -> plans -> news -> brief -> database")
    sp.add_argument("--dry-run", action="store_true", help="write nothing to the database / Telegram")
    sp.add_argument("--limit", type=int, default=None, help="cap universe size (debug)")
    sp.add_argument("--force", action="store_true", help="run even on a non-trading day")
    sp.set_defaults(fn=lambda a: _lazy("swing.jobs", "run_nightly")(a))

    sp = sub.add_parser("premarket", help="07:00 ET: regime + macro blackout")
    sp.add_argument("--dry-run", action="store_true")
    sp.add_argument("--force", action="store_true")
    sp.set_defaults(fn=lambda a: _lazy("swing.jobs", "run_premarket")(a))

    sp = sub.add_parser("intraday", help="every 15 min 10:00-15:45 ET: alerts (+manage at 15:45)")
    sp.add_argument("--dry-run", action="store_true")
    sp.add_argument("--force", action="store_true")
    sp.add_argument("--manage", action="store_true", help="force the 15:45 management pass")
    sp.set_defaults(fn=lambda a: _lazy("swing.jobs", "run_intraday")(a))

    sp = sub.add_parser("db-init", help="create/verify Neon tables (requires DATABASE_URL)")
    sp.set_defaults(fn=cmd_db_init)

    sub.add_parser("db-push", help="copy state/journal.sqlite into Neon (DATABASE_URL)").set_defaults(fn=cmd_db_push)

    sp = sub.add_parser("report", help="weekly expectancy/SQN report from the journal")
    sp.add_argument("--dry-run", action="store_true")
    sp.set_defaults(fn=lambda a: _lazy("swing.jobs", "run_report")(a))

    sp = sub.add_parser("tick", help="every 15 min: run active-strategy jobs that are due")
    sp.set_defaults(fn=lambda a: _lazy("swing.tick", "run_tick")(a))

    sp = sub.add_parser("parity", help="compare local Scan A with tradingview-screener (optional extra)")
    sp.set_defaults(fn=lambda a: _lazy("swing.extras.parity", "cmd_parity")(a))

    args = p.parse_args(argv)
    _setup_logging(args.verbose)
    try:
        return int(args.fn(args) or 0)
    finally:
        if args.cmd in {"check", "nightly", "premarket", "intraday", "report"}:
            from swing.data.usage import flush

            saved = flush(job=None if args.cmd == "check" else args.cmd)
            if saved is not None:
                n = sum(int(v) for v in saved.get("calls", {}).values())
                scope = "keys" if args.cmd == "check" else args.cmd
                print(f"api usage: {n} live calls stored for {saved['date']} ({scope}, dashboard /apis)")


def _lazy(module: str, fn: str):
    import importlib

    return getattr(importlib.import_module(module), fn)


if __name__ == "__main__":
    sys.exit(main())
