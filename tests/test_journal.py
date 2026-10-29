import json
from datetime import date, datetime

from swing import journal
from swing.models import Alert, PlanCard, Position


def _plan(symbol: str, entry: float = 100.5) -> PlanCard:
    return PlanCard(
        symbol=symbol,
        pattern="flat_base",
        resistance=100,
        entry=entry,
        stop=94,
        risk_per_share=6.5,
        stop_pct=6.5,
        shares=7,
        fractional_shares=7.4,
        notional=700,
        target_2r=113.5,
        target_3r=120,
        atr14=2,
        stop_atr_mult=3,
        trend_score=7,
        pattern_quality=7.5,
        alert_level=100,
    )


def test_brief_and_chart_roundtrip(tmp_path):
    db = tmp_path / "j.sqlite"
    journal.save_brief(date(2026, 10, 7), "nightly", {"hello": 1, "kind": "nightly"}, path=db)
    journal.save_chart("2026-10-07", "AAPL", "daily", b"\x89PNG\r\n", path=db)
    loaded = journal.latest_brief("nightly", path=db)
    assert loaded == {"hello": 1, "kind": "nightly"}
    png = journal.load_chart("2026-10-07", "AAPL", "daily", path=db)
    assert png == b"\x89PNG\r\n"
    assert journal.load_chart("2026-10-07", "AAPL", "weekly", path=db) is None


def test_connect_without_path_requires_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    try:
        journal.require()
        raise AssertionError("expected RuntimeError")
    except RuntimeError as e:
        assert "DATABASE_URL" in str(e)


def test_migrates_notion_era_alerts_table(tmp_path):
    import sqlite3

    db = tmp_path / "old.sqlite"
    con = sqlite3.connect(db)
    con.execute(
        """CREATE TABLE alerts (
          ts TEXT, symbol TEXT, condition TEXT, price REAL, rvol REAL, vwap REAL, actionable INTEGER, message TEXT,
          PRIMARY KEY (ts, symbol, condition))"""
    )
    con.execute(
        "INSERT INTO alerts VALUES ('2026-10-07T11:00:00', 'AAPL', 'breakout', 1, 1.5, 1, 0, 'x')"
    )
    con.commit()
    con.close()
    new = journal.save_alerts(
        [Alert(ts=datetime(2026, 10, 8, 11, 6), symbol="XOM", condition="resistance", price=10, message="hit")],
        path=db,
    )
    assert len(new) == 1
    with journal.connect(db) as j:
        rows = j.all("SELECT day, symbol FROM alerts ORDER BY symbol")
    assert {r["symbol"] for r in rows} == {"AAPL", "XOM"}
    assert all(r["day"] for r in rows)


def test_watchlist_keeps_the_original_and_offers_a_new_plan(tmp_path):
    db = tmp_path / "j.sqlite"
    saved = _plan("SAVED", entry=100.5)
    plan_id = journal.save_watch(saved, date(2026, 10, 7), path=db)
    with journal.connect(db) as j:
        first = j.one("SELECT saved_at FROM watchlist WHERE id=?", (plan_id,))
    newer = _plan("SAVED", entry=111.0)
    other = _plan("SAVED", entry=100.5)
    other.pattern = "cup_handle"
    added = journal.refresh_watch([newer, other, _plan("NEW"), _plan("SAVED", entry=100.6)], date(2026, 10, 8), path=db)
    assert added == 2
    got = journal.watchlist_plans(path=db)
    assert [p.symbol for p in got] == ["SAVED"]
    assert got[0].entry == 100.5
    rows = journal.list_watch(path=db)
    assert len(rows) == 3
    candidates = [r for r in rows if r.role == "candidate"]
    assert {r.plan.pattern for r in candidates} == {"flat_base", "cup_handle"}
    assert journal.get_watch(plan_id, path=db).plan.entry == 100.5
    with journal.connect(db) as j:
        row = j.one("SELECT saved_at, plan_date FROM watchlist WHERE id=?", (plan_id,))
    assert row["saved_at"] == first["saved_at"]
    assert str(row["plan_date"]).startswith("2026-10-07")

    flat = next(r for r in candidates if r.plan.pattern == "flat_base")
    cup = next(r for r in candidates if r.plan.pattern == "cup_handle")
    assert journal.add_candidate(flat.id, path=db) is True
    assert len(journal.active_watch(path=db)) == 2
    assert journal.switch_watch(cup.id, plan_id, path=db) is True
    retired = journal.get_watch(plan_id, path=db)
    adopted = journal.get_watch(cup.id, path=db)
    assert retired is not None and retired.active is False and retired.plan.entry == 100.5
    assert adopted is not None and adopted.active and adopted.role == "saved"
    assert {p.pattern for p in journal.watchlist_plans(path=db)} == {"cup_handle", "flat_base"}

    journal.set_watch_verdict(adopted.id, "still_good", "Price 99.00 is still above the original stop 94.00.", path=db)
    judged = journal.get_watch(adopted.id, path=db)
    assert judged is not None and judged.verdict == "still_good"
    assert journal.delete_watch(flat.id, path=db) is True
    assert journal.get_watch(flat.id, path=db) is None
    assert journal.delete_watch("SAVED", path=db) is True
    assert journal.list_watch(path=db) == []
    assert journal.delete_watch("SAVED", path=db) is False


def test_position_stance_follows_the_bound_plan(tmp_path):
    db = tmp_path / "j.sqlite"
    plan = _plan("POS", entry=100.5)
    plan_id = journal.save_watch(plan, date(2026, 10, 7), path=db)
    journal.upsert_position(
        Position(
            symbol="POS",
            opened=date(2026, 10, 1),
            entry=101,
            stop=95,
            initial_stop=95,
            shares=10,
            target_2r=113,
            plan_id=plan_id,
            original_plan=plan,
        ),
        path=db,
    )
    journal.set_position_stance("POS", "keep", "Price is still above the original stop.", path=db)
    got = journal.open_positions(path=db)[0]
    assert got.stance == "keep"
    assert got.plan_id == plan_id
    assert got.original_plan is not None and got.original_plan.entry == 100.5
    journal.set_position_stance("POS", "exit", "Price is through the live stop.", path=db)
    assert journal.open_positions(path=db)[0].stance == "exit"


def test_alerts_do_not_collapse_two_plans(tmp_path):
    db = tmp_path / "j.sqlite"
    ts = datetime(2026, 10, 8, 11, 6)
    first = Alert(ts=ts, symbol="XOM", condition="approaching", price=10, message="a", plan_id="one")
    second = Alert(ts=ts, symbol="XOM", condition="approaching", price=11, message="b", plan_id="two")
    assert len(journal.save_alerts([first, second], path=db)) == 2
    assert journal.save_alerts([first], path=db) == []


def test_unsaved_names_drop_after_the_day(tmp_path):
    db = tmp_path / "j.sqlite"
    journal.save_plans(date(2026, 10, 7), [_plan("SAVED"), _plan("GONE")], path=db)
    journal.save_plans(date(2026, 10, 8), [_plan("TODAY")], path=db)
    journal.save_watch(_plan("SAVED"), date(2026, 10, 7), path=db)
    journal.upsert_position(
        Position(
            symbol="POS",
            opened=date(2026, 10, 1),
            entry=100,
            stop=94,
            initial_stop=94,
            shares=10,
            target_2r=112,
        ),
        path=db,
    )
    journal.save_alerts(
        [
            Alert(ts=datetime(2026, 10, 7, 11, 0), symbol="SAVED", condition="approaching", price=99, message="keep"),
            Alert(ts=datetime(2026, 10, 7, 11, 0), symbol="GONE", condition="approaching", price=99, message="drop"),
            Alert(ts=datetime(2026, 10, 7, 11, 0), symbol="POS", condition="stop_hit", price=93, message="hold"),
            Alert(ts=datetime(2026, 10, 8, 11, 0), symbol="TODAY", condition="approaching", price=99, message="same day"),
        ],
        path=db,
    )

    removed = journal.drop_unsaved(date(2026, 10, 8), path=db)
    assert removed["plans"] == 1
    assert removed["alerts"] == 1
    assert {p.symbol for p in journal.plans_for(date(2026, 10, 7), path=db)} == {"SAVED"}
    assert {p.symbol for p in journal.plans_for(date(2026, 10, 8), path=db)} == {"TODAY"}
    with journal.connect(db) as j:
        left = {r["symbol"] for r in j.all("SELECT symbol FROM alerts")}
    assert left == {"SAVED", "POS", "TODAY"}

    journal.delete_watch("SAVED", path=db)
    journal.drop_unsaved(date(2026, 10, 8), path=db)
    assert journal.plans_for(date(2026, 10, 7), path=db) == []


def _save_strategy(path, name, status="active", nightly=True, sid="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", updated="2026-10-08T15:00:00+00:00"):
    payload = {"flow": {"clocks": {"nightly": {"enabled": nightly, "start": "16:48"}}}}
    with journal.connect(path) as db:
        db.execute(
            "INSERT INTO strategies (id, name, status, payload, updated_at) VALUES (?,?,?,?,?)",
            (sid, name, status, json.dumps(payload), updated),
        )


def test_stamp_plan_strategy_names_the_active_strategy(tmp_path):
    db = tmp_path / "j.sqlite"
    _save_strategy(db, "Tight base")
    _save_strategy(db, "Draft only", status="draft", sid="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    plan = _plan("AAPL")
    journal.stamp_plan_strategy([plan], path=db)
    assert plan.strategy_name == "Tight base"
    assert plan.strategy_id == "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    assert "AAPL | Tight base |" in plan.card_text()


def test_stamp_plan_strategy_uses_the_latest_nightly_strategy(tmp_path):
    db = tmp_path / "j.sqlite"
    _save_strategy(db, "Tight base", updated="2026-10-08T15:00:00+00:00")
    _save_strategy(
        db,
        "Opening range",
        sid="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        updated="2026-10-09T15:00:00+00:00",
    )
    _save_strategy(db, "Paused book", status="paused", sid="cccccccc-cccc-4ccc-8ccc-cccccccccccc")
    plan = _plan("MSFT")
    journal.stamp_plan_strategy([plan], path=db)
    assert plan.strategy_name == "Opening range"
    assert plan.strategy_id == "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
