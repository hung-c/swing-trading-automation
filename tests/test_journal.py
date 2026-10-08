from datetime import date, datetime

from swing import journal
from swing.models import Alert


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
