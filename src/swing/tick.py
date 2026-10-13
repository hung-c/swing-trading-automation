"""One 15-minute tick. Decides which of the four jobs are due, then runs those.

Start times live on each active strategy's clocks (web/lib/strategy-flow.ts) and are Swing Tick
times. A missing nightly start, or one left at 16:48, moves to 13:48 on an early-close day.
A strategy still saved as 16:37 moves to 13:37. Any other nightly time is used as written.

The runners stay desk-wide (config.yaml). This module only chooses when they start.
"""

from __future__ import annotations

import argparse
import logging
import socket
from datetime import UTC, datetime, time, timedelta
from pathlib import Path

from swing import journal
from swing.calendars import is_early_close, is_trading_day, now_et

log = logging.getLogger(__name__)

# Keep in sync with CLOCK_DEFAULTS in web/lib/strategy-flow.ts.
JOB_ORDER = ("premarket", "intraday", "nightly", "report")
DEFAULT_START = {
    "premarket": time(7, 3),
    "intraday": time(10, 3),
    "nightly": time(16, 48),
    "report": time(17, 18),
}
DEFAULT_INTRADAY_END = time(15, 48)
# Default tick, plus the older 16:37 default, both shift three hours on an early close.
NIGHTLY_SHIFTS = {
    time(16, 48): time(13, 48),
    time(16, 37): time(13, 37),
}
RUN_STALE = timedelta(minutes=60)
INTERVAL = timedelta(minutes=15)
# A failed or stuck once-job may retry on later ticks. The window closes after the
# hour-long stale limit plus one more tick, so a morning job does not run in the afternoon.
ONCE_CATCH_UP = RUN_STALE + INTERVAL


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
            if job == "nightly" and early_close and start in NIGHTLY_SHIFTS:
                start = NIGHTLY_SHIFTS[start]
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


def _once_open(start: time, now: datetime) -> bool:
    """True from the clock time until the catch-up window ends. Both instants are on ``now``'s date."""
    origin = datetime.combine(now.date(), start, tzinfo=now.tzinfo)
    return origin <= now < origin + ONCE_CATCH_UP


def _in_window(job: str, window: dict, now: datetime, *, early_close: bool = False) -> bool:
    start: time = window["start"]
    if job == "report" and now.weekday() != 4:
        return False
    if job == "intraday":
        end: time = window["end"] or DEFAULT_INTRADAY_END
        # The cash session stops at 13:00 on an early-close day. The :48 pass before that is the last one.
        if early_close:
            end = min(end, time(13, 0))
        if end < start:
            return False
        return start <= now.time() <= end
    return _once_open(start, now)


def _slot_start(now: datetime, start: time) -> datetime:
    """Start of the 15-minute slot that contains ``now``, aligned to the strategy clock."""
    origin = datetime.combine(now.date(), start, tzinfo=now.tzinfo)
    if now <= origin:
        return origin
    elapsed = now - origin
    return origin + (elapsed // INTERVAL) * INTERVAL


def _blocked(job: str, window: dict, runs: list[dict], now: datetime) -> bool:
    """An ok once-job today, an intraday ok already in this slot, or a run still inside the last hour blocks a start.

    Intraday is once per 15-minute slot. Age from ``started_at`` is a few seconds
    longer than the gap between ticks, so a raw 15-minute cooldown skips every other slot.
    """
    start_at = datetime.combine(now.date(), window["start"], tzinfo=now.tzinfo)
    slot = _slot_start(now, window["start"]) if job == "intraday" else None
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
        if slot is not None:
            if started >= slot:
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
        if window is None or not _in_window(job, window, now, early_close=early_close):
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


def _utc() -> str:
    return datetime.now(UTC).isoformat()


def _heartbeat(path: Path | None, payload: dict) -> None:
    """One kv row, `tick`, so the dashboard can see the PC between jobs."""
    try:
        journal.kv_set("tick", payload, path=path)
    except Exception:
        log.exception("tick heartbeat failed")


def run_tick(args) -> int:
    """Exit immediately on a closed session. Otherwise run each due job, in order.

    Every exit writes the `tick` kv row: running while jobs are in progress, then idle, ok, or failed.
    """
    now = now_et()
    path = getattr(args, "path", None)
    started = _utc()
    host = socket.gethostname()

    def beat(**extra) -> None:
        _heartbeat(path, {"host": host, "started_at": started, "at": now.isoformat(), **extra})

    if not is_trading_day(now.date()):
        msg = f"not a trading day ({now.date()})"
        log.info("not a trading day (%s); tick exits", now.date())
        print(f"tick: {msg}")
        beat(status="idle", finished_at=_utc(), due=[], message=msg, exit=0)
        return 0

    beat(status="running", finished_at=None, due=[], message=f"tick {now:%H:%M} ET", exit=None)
    try:
        due = due_jobs(now, path=path, early_close=is_early_close(now.date()))
        if not due:
            print(f"tick {now:%H:%M} ET: nothing due")
            beat(status="idle", finished_at=_utc(), due=[], message="nothing due", exit=0)
            return 0
        print(f"tick {now:%H:%M} ET: {', '.join(due)}")
        beat(
            status="running",
            finished_at=None,
            due=list(due),
            message=f"tick {now:%H:%M} ET: {', '.join(due)}",
            exit=None,
        )
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
        status = "failed" if failed else "ok"
        beat(status=status, finished_at=_utc(), due=list(due), message=", ".join(due), exit=1 if failed else 0)
        return 1 if failed else 0
    except Exception as exc:
        beat(status="failed", finished_at=_utc(), due=[], message=str(exc)[:500], exit=1)
        raise
