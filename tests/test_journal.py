from datetime import date

from swing import journal


def test_brief_and_chart_roundtrip(tmp_path):
    db = tmp_path / "j.sqlite"
    journal.save_brief(date(2026, 10, 7), "nightly", {"hello": 1, "kind": "nightly"}, path=db)
    journal.save_chart("2026-10-07", "AAPL", "daily", b"\x89PNG\r\n", path=db)
    loaded = journal.latest_brief("nightly", path=db)
    assert loaded == {"hello": 1, "kind": "nightly"}
    png = journal.load_chart("2026-10-07", "AAPL", "daily", path=db)
    assert png == b"\x89PNG\r\n"
    assert journal.load_chart("2026-10-07", "AAPL", "weekly", path=db) is None
