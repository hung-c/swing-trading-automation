"""Entry points: `swing nightly | premarket | intraday | eod | setup-notion | check`."""

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
        "notion": has_env("NOTION_TOKEN", "NOTION_PARENT_PAGE_ID"),
        "massive": has_env("MASSIVE_KEY"),
        "telegram": has_env("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"),
    }
    for k, v in secrets.items():
        print(f"  secret {k:12s} {'OK' if v else 'missing'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="swing")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("check", help="config/calendar/secrets smoke test").set_defaults(fn=cmd_check)

    sp = sub.add_parser("nightly", help="16:35 ET: screen -> patterns -> plans -> news -> brief -> Notion")
    sp.add_argument("--dry-run", action="store_true", help="do not publish to Notion")
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

    sp = sub.add_parser("setup-notion", help="create the Notion parent page + 4 databases (idempotent)")
    sp.set_defaults(fn=lambda a: _lazy("swing.notion_publisher", "cmd_setup")(a))

    sp = sub.add_parser("report", help="weekly expectancy/SQN report from the journal")
    sp.add_argument("--dry-run", action="store_true")
    sp.set_defaults(fn=lambda a: _lazy("swing.jobs", "run_report")(a))

    sp = sub.add_parser("parity", help="compare local Scan A with tradingview-screener (optional extra)")
    sp.set_defaults(fn=lambda a: _lazy("swing.extras.parity", "cmd_parity")(a))

    args = p.parse_args(argv)
    _setup_logging(args.verbose)
    return int(args.fn(args) or 0)


def _lazy(module: str, fn: str):
    import importlib

    return getattr(importlib.import_module(module), fn)


if __name__ == "__main__":
    sys.exit(main())
