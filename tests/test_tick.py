"""Due rules for the 15-minute tick. Times are ET. The market calendar is not called."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from zoneinfo import ZoneInfo

from swing import journal
from swing.tick import due_jobs, run_tick

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


def test_once_job_does_not_run_after_its_window(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(
        db,
        "desk",
        "active",
        {
            "premarket": {"enabled": True, "start": "07:03"},
            "nightly": {"enabled": True, "start": "16:37"},
        },
    )
    assert due_jobs(at("08:03"), path=db, early_close=False) == ["premarket"]
    assert "premarket" not in due_jobs(at("08:18"), path=db, early_close=False)
    assert due_jobs(at("16:18"), path=db, early_close=False) == []
    assert due_jobs(at("16:37"), path=db, early_close=False) == ["nightly"]


def test_intraday_repeats_after_15_minutes(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"intraday": {"enabled": True, "start": "10:00", "end": "15:50"}})
    assert "intraday" not in due_jobs(at("09:59"), path=db, early_close=False)
    assert due_jobs(at("10:00"), path=db, early_close=False) == ["intraday"]
    stamp(db, "intraday", "ok", at("10:00"))
    assert "intraday" not in due_jobs(at("10:14"), path=db, early_close=False)
    assert due_jobs(at("10:15"), path=db, early_close=False) == ["intraday"]
    assert "intraday" not in due_jobs(at("15:51"), path=db, early_close=False)


def test_intraday_late_start_does_not_skip_the_next_slot(tmp_path):
    """The job row is stamped a few seconds after the tick. That must not eat the next slot."""
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"intraday": {"enabled": True, "start": "10:03", "end": "15:48"}})
    stamp(db, "intraday", "ok", at("10:03").replace(second=7))
    assert "intraday" not in due_jobs(at("10:17"), path=db, early_close=False)
    assert due_jobs(at("10:18").replace(second=1), path=db, early_close=False) == ["intraday"]


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


def test_early_close_intraday_stops_at_1300(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"intraday": {"enabled": True, "start": "10:03", "end": "15:48"}})
    assert due_jobs(at("12:48", "2026-11-27"), path=db, early_close=True) == ["intraday"]
    assert "intraday" not in due_jobs(at("13:03", "2026-11-27"), path=db, early_close=True)
    assert due_jobs(at("14:18", "2026-10-12"), path=db, early_close=False) == ["intraday"]


def test_early_close_nightly_default_is_1348(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"nightly": {"enabled": True}})
    assert "nightly" not in due_jobs(at("13:33"), path=db, early_close=True)
    assert due_jobs(at("13:48"), path=db, early_close=True) == ["nightly"]
    stamp(db, "nightly", "ok", at("13:48"))
    assert "nightly" not in due_jobs(at("16:48"), path=db, early_close=True)


def test_legacy_1637_still_shifts_on_early_close(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"nightly": {"enabled": True, "start": "16:37"}})
    assert "nightly" not in due_jobs(at("13:36"), path=db, early_close=True)
    assert due_jobs(at("13:37"), path=db, early_close=True) == ["nightly"]


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


def test_tick_heartbeat_on_a_closed_day(tmp_path, monkeypatch):
    db = tmp_path / "j.sqlite"
    monkeypatch.setattr("swing.tick.now_et", lambda: at("09:18", "2026-10-10"))
    monkeypatch.setattr("swing.tick.is_trading_day", lambda _day: False)
    assert run_tick(argparse.Namespace(path=db)) == 0
    beat = journal.kv_get("tick", path=db)
    assert beat["status"] == "idle"
    assert beat["due"] == []
    assert beat["exit"] == 0
    assert "not a trading day" in beat["message"]
    assert beat["finished_at"]
    assert beat["host"]


def test_tick_heartbeat_when_nothing_is_due(tmp_path, monkeypatch):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"premarket": {"enabled": True, "start": "07:03"}})
    stamp(db, "premarket", "ok", at("07:03"))
    monkeypatch.setattr("swing.tick.now_et", lambda: at("09:18"))
    monkeypatch.setattr("swing.tick.is_trading_day", lambda _day: True)
    monkeypatch.setattr("swing.tick.is_early_close", lambda _day: False)
    assert run_tick(argparse.Namespace(path=db)) == 0
    beat = journal.kv_get("tick", path=db)
    assert beat["status"] == "idle"
    assert beat["due"] == []
    assert beat["message"] == "nothing due"


def test_tick_heartbeat_while_a_job_runs(tmp_path, monkeypatch):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"premarket": {"enabled": True, "start": "07:03"}})
    monkeypatch.setattr("swing.tick.now_et", lambda: at("07:03"))
    monkeypatch.setattr("swing.tick.is_trading_day", lambda _day: True)
    monkeypatch.setattr("swing.tick.is_early_close", lambda _day: False)
    monkeypatch.setattr("swing.data.usage.flush", lambda **_kwargs: None)
    seen = {}

    def fake(_args):
        seen["mid"] = journal.kv_get("tick", path=db)
        return 0

    import swing.jobs as jobs

    monkeypatch.setattr(jobs, "run_premarket", fake)
    assert run_tick(argparse.Namespace(path=db)) == 0
    assert seen["mid"]["status"] == "running"
    assert seen["mid"]["due"] == ["premarket"]
    beat = journal.kv_get("tick", path=db)
    assert beat["status"] == "ok"
    assert beat["due"] == ["premarket"]
    assert beat["exit"] == 0
    assert beat["finished_at"]


def test_report_only_on_friday(tmp_path):
    db = tmp_path / "j.sqlite"
    add_strategy(db, "desk", "active", {"report": {"enabled": True, "start": "17:11"}})
    assert due_jobs(at("17:11", "2026-10-08"), path=db, early_close=False) == []
    assert due_jobs(at("17:11"), path=db, early_close=False) == ["report"]
