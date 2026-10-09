"""One 15-minute tick. Decides which of the four jobs are due, then runs those.

Start times live on each active strategy's clocks (web/lib/strategy-flow.ts). Defaults match
the old fixed schedule. A missing start, or nightly left at 16:37, still moves to 13:37 on an
early-close day. Any other nightly time is used as written.

The runners stay desk-wide (config.yaml). This module only chooses when they start.
"""

from __future__ import annotations

import argparse
import logging
from datetime import UTC, datetime, time, timedelta
from pathlib import Path

from swing import journal
from swing.calendars import is_early_close, is_trading_day, now_et

log = logging.getLogger(__name__)

# Keep in sync with CLOCK_DEFAULTS in web/lib/strategy-flow.ts.
JOB_ORDER = ("premarket", "intraday", "nightly", "report")
DEFAULT_START = {
    "premarket": time(7, 3),
    "intraday": time(10, 0),
    "nightly": time(16, 37),
    "report": time(17, 11),
}
DEFAULT_INTRADAY_END = time(15, 50)
NIGHTLY_DEFAULT = time(16, 37)
EARLY_CLOSE_NIGHTLY = time(13, 37)
RUN_STALE = timedelta(minutes=60)
INTERVAL = timedelta(minutes=15)


def _parse_hhmm(value, fallback: time) -> time:
    if not isinstance(value, str):
        return fallback
    parts = value.strip().split(":")
    if len(parts) != 2:
        return fallback
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except ValueError:
        return fallback
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return fallback
    return time(hour, minute)


def _clocks(payload) -> dict:
    if not isinstance(payload, dict):
        return {}
    flow = payload.get("flow")
    if not isinstance(flow, dict):
        return {}
    clocks = flow.get("clocks")
    return clocks if isinstance(clocks, dict) else {}


def _windows(strategies: list[dict], early_close: bool) -> dict[str, dict]:
    """Earliest enabled start per job, and the latest intraday end."""
    windows: dict[str, dict] = {}
    for row in strategies:
        if row.get("status") != "active":
            continue
        clocks = _clocks(row.get("payload"))
        for job in JOB_ORDER:
            raw = clocks.get(job)
            if not isinstance(raw, dict) or raw.get("enabled") is not True:
                continue
            start = _parse_hhmm(raw.get("start"), DEFAULT_START[job])
            if job == "nightly" and early_close and start == NIGHTLY_DEFAULT:
                start = EARLY_CLOSE_NIGHTLY
            end = _parse_hhmm(raw.get("end"), DEFAULT_INTRADAY_END) if job == "intraday" else None
            current = windows.get(job)
            if current is None:
                windows[job] = {"start": start, "end": end}
                continue
            if start < current["start"]:
                current["start"] = start
            if end is not None and (current["end"] is None or end > current["end"]):
                current["end"] = end
    return windows


def _parse_ts(value) -> datetime | None:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str) and value:
        dt = datetime.fromisoformat(value)
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _in_window(job: str, window: dict, now: datetime) -> bool:
    start: time = window["start"]
    if job == "report" and now.weekday() != 4:
        return False
    if job == "intraday":
        end: time = window["end"] or DEFAULT_INTRADAY_END
        if end < start:
            return False
        return start <= now.time() <= end
    return now.time() >= start


def _blocked(job: str, window: dict, runs: list[dict], now: datetime) -> bool:
    """An ok once-job today, a fresh intraday ok, or a run still inside the last hour blocks a start."""
    start_at = datetime.combine(now.date(), window["start"], tzinfo=now.tzinfo)
    for run in runs:
        if run.get("job") != job or run.get("step") not in (None, ""):
            continue
        started = _parse_ts(run.get("started_at"))
        if started is None:
            continue
        age = now - started
        if age < timedelta(0):
            continue
        status = run.get("status")
        if status == "running" and age < RUN_STALE:
            return True
        if status != "ok":
            continue
        if job == "intraday":
            if age < INTERVAL:
                return True
        elif started >= start_at:
            return True
    return False


def jobs_due(strategies: list[dict], runs: list[dict], now: datetime, *, early_close: bool) -> list[str]:
    """Jobs to start now. ``runs`` are job_runs rows; step rows are ignored. ``now`` is ET."""
    windows = _windows(strategies, early_close)
    due: list[str] = []
    for job in JOB_ORDER:
        window = windows.get(job)
        if window is None or not _in_window(job, window, now):
            continue
        if _blocked(job, window, runs, now):
            continue
        due.append(job)
    return due


def due_jobs(now: datetime, *, path: Path | None = None, early_close: bool = False) -> list[str]:
    """Read strategies and job_runs, then decide. ``now`` is timezone-aware ET."""
    strategies = journal.list_strategies(path=path)
    runs = journal.list_job_runs(path=path)
    return jobs_due(strategies, runs, now, early_close=early_close)


def _runner_args() -> argparse.Namespace:
    return argparse.Namespace(dry_run=False, force=False, limit=None, manage=False, from_tick=True)


def run_tick(args) -> int:
    """Exit immediately on a closed session. Otherwise run each due job, in order."""
    now = now_et()
    if not is_trading_day(now.date()):
        log.info("not a trading day (%s); tick exits", now.date())
        print(f"tick: not a trading day ({now.date()})")
        return 0
    path = getattr(args, "path", None)
    due = due_jobs(now, path=path, early_close=is_early_close(now.date()))
    if not due:
        print(f"tick {now:%H:%M} ET: nothing due")
        return 0
    print(f"tick {now:%H:%M} ET: {', '.join(due)}")
    from swing import jobs
    from swing.data.usage import flush

    runners = {
        "premarket": jobs.run_premarket,
        "intraday": jobs.run_intraday,
        "nightly": jobs.run_nightly,
        "report": jobs.run_report,
    }
    failed = False
    for job in due:
        try:
            rc = runners[job](_runner_args())
            if rc:
                failed = True
        except Exception:
            log.exception("tick job %s failed", job)
            failed = True
        finally:
            try:
                flush(path=path, job=job)
            except Exception:
                log.exception("usage flush for %s failed", job)
    return 1 if failed else 0
