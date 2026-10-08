from swing import journal
from swing.jobs import JobRun


def test_job_run_roundtrip(tmp_path):
    db = tmp_path / "j.sqlite"
    rid = journal.begin_run("nightly", path=db)
    journal.record_step(rid, "nightly", "universe", "ok", {"symbols": 4}, path=db)
    journal.record_step(rid, "nightly", "bars", "ok", {"provider": "alpaca"}, path=db)
    journal.finish_run(rid, "ok", {"plans": 2}, path=db)

    rows = journal.list_job_runs(path=db)
    by_step = {r["step"]: r for r in rows}
    assert by_step[None]["status"] == "ok"
    assert by_step[None]["summary"] == {"plans": 2}
    assert by_step[None]["finished_at"]
    assert by_step["universe"]["summary"] == {"symbols": 4}
    assert by_step["bars"]["status"] == "ok"
    assert by_step["bars"]["summary"]["provider"] == "alpaca"


def test_failed_step_marks_step_and_job(tmp_path):
    db = tmp_path / "j.sqlite"
    run = JobRun("premarket", path=db)
    try:
        with run.step("regime") as st:
            st.summary = {"sizing": "half"}
            raise RuntimeError("regime down")
    except RuntimeError as e:
        run.fail(str(e))
    finally:
        run.close()

    rows = journal.list_job_runs(path=db, job="premarket")
    by_step = {r["step"]: r for r in rows}
    assert by_step["regime"]["status"] == "failed"
    assert by_step["regime"]["error"] == "regime down"
    assert by_step["regime"]["summary"] == {"sizing": "half"}
    assert by_step[None]["status"] == "failed"
    assert "regime down" in (by_step[None]["error"] or "")


def test_dry_run_writes_nothing(tmp_path):
    db = tmp_path / "j.sqlite"
    run = JobRun("nightly", dry_run=True, path=db)
    with run.step("universe") as st:
        st.summary = {"symbols": 1}
    run.finish("ok", {"plans": 0})
    run.close()
    assert journal.list_job_runs(path=db) == []
