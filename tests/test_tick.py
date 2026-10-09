"""Due rules for the 15-minute tick. Times are ET. The market calendar is not called."""

from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

from swing import journal
from swing.tick import due_jobs

ET = ZoneInfo("America/New_York")


def at(hhmm: str, day: str = "2026-10-09") -> datetime:
    """2026-10-09 is a Friday."""
    return datetime.fromisoformat(f"{day}T{hhmm}:00").replace(tzinfo=ET)


def add_strategy(path, sid: str, status: str, clocks: dict) -> None:
    with journal.connect(path) as db:
        db.execute(
            "INSERT INTO strategies (id, name, status, payload, updated_at) VALUES (?,?,?,?,?)",
            (sid, sid, status, json.dumps({"flow": {"clocks": clocks}}), "2026-10-09T12:00:00+00:00"),
        )


def stamp(path, job: str, status: str, started: datetime) -> None:
    rid = journal.begin_run(job, path=path)
    finished = None if status == "running" else started.isoformat()
    with journal.connect(path) as db:
        db.execute(
            "UPDATE job_runs SET status=?, started_at=?, finished_at=? WHERE id=?",
            (status, started.isoformat(), finished, rid),
        )


def test_before_start_nothing_is_due(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(
        db,
        "desk",
        "active",
        {
            "premarket": {"enabled": True},
            "intraday": {"enabled": True},
            "nightly": {"enabled": True},
            "report": {"enabled": False},
        },
    )
    assert due_jobs(at("07:02"), path=db, early_close=False) == []


def test_once_job_runs_then_does_not_repeat(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"premarket": {"enabled": True, "start": "07:03"}})
    assert due_jobs(at("07:03"), path=db, early_close=False) == ["premarket"]
    stamp(db, "premarket", "ok", at("07:03"))
    assert due_jobs(at("07:18"), path=db, early_close=False) == []


def test_fresh_running_row_blocks_until_it_is_an_hour_old(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"premarket": {"enabled": True}})
    stamp(db, "premarket", "running", at("07:03"))
    assert due_jobs(at("07:18"), path=db, early_close=False) == []
    assert due_jobs(at("08:04"), path=db, early_close=False) == ["premarket"]


def test_failed_once_job_retries(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"premarket": {"enabled": True}})
    stamp(db, "premarket", "failed", at("07:03"))
    assert due_jobs(at("07:18"), path=db, early_close=False) == ["premarket"]


def test_intraday_repeats_after_15_minutes(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"intraday": {"enabled": True, "start": "10:00", "end": "15:50"}})
    assert "intraday" not in due_jobs(at("09:59"), path=db, early_close=False)
    assert due_jobs(at("10:00"), path=db, early_close=False) == ["intraday"]
    stamp(db, "intraday", "ok", at("10:00"))
    assert "intraday" not in due_jobs(at("10:14"), path=db, early_close=False)
    assert due_jobs(at("10:15"), path=db, early_close=False) == ["intraday"]
    assert "intraday" not in due_jobs(at("15:51"), path=db, early_close=False)


def test_draft_and_paused_do_not_schedule(tmp_path):
    db = tmp_path / "j.sqlite"
    clocks = {
        "premarket": {"enabled": True},
        "intraday": {"enabled": True},
        "nightly": {"enabled": True},
        "report": {"enabled": True},
    }
    add_strategy(db, "draft", "draft", clocks)
    add_strategy(db, "paused", "paused", clocks)
    assert due_jobs(at("10:00"), path=db, early_close=False) == []
    assert due_jobs(at("17:11"), path=db, early_close=False) == []


def test_early_close_nightly_default_is_1337(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"nightly": {"enabled": True}})
    assert "nightly" not in due_jobs(at("13:36"), path=db, early_close=True)
    assert due_jobs(at("13:37"), path=db, early_close=True) == ["nightly"]
    stamp(db, "nightly", "ok", at("13:37"))
    assert "nightly" not in due_jobs(at("16:37"), path=db, early_close=True)


def test_custom_nightly_time_is_not_shifted(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"nightly": {"enabled": True, "start": "15:00"}})
    assert "nightly" not in due_jobs(at("13:37"), path=db, early_close=True)
    assert due_jobs(at("15:00"), path=db, early_close=True) == ["nightly"]


def test_earliest_start_across_active_strategies(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "late", "active", {"premarket": {"enabled": True, "start": "08:00"}})
    add_strategy(db, "early", "active", {"premarket": {"enabled": True, "start": "07:30"}})
    assert "premarket" not in due_jobs(at("07:15"), path=db, early_close=False)
    assert due_jobs(at("07:30"), path=db, early_close=False) == ["premarket"]


def test_report_only_on_friday(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"report": {"enabled": True, "start": "17:11"}})
    assert due_jobs(at("17:11", "2026-10-08"), path=db, early_close=False) == []
    assert due_jobs(at("17:11"), path=db, early_close=False) == ["report"]
