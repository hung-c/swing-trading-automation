from swing.data import usage


def test_provider_for_url():
    assert usage.provider_for_url("https://finnhub.io/api/v1/calendar/earnings") == "finnhub"
    assert usage.provider_for_url("https://api.nasdaq.com/api/screener/stocks") == "nasdaq"
    assert usage.provider_for_url("https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt") == "nasdaq"
    assert usage.provider_for_url("https://api.massive.com/v2/aggs/grouped/locale/us/market/stocks/2026-10-07") == "massive"
    assert usage.provider_for_url("https://www.alphavantage.co/query") == "alphavantage"
    assert usage.provider_for_url("https://data.sec.gov/submissions/CIK0000320193.json") == "sec"
    assert usage.provider_for_url("https://api.groq.com/openai/v1") == "groq"
    assert usage.provider_for_url("https://example.com") is None


def test_flush_merges_counts_and_resets_on_a_new_day(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    db = tmp_path / "j.sqlite"
    usage.reset()
    monkeypatch.setattr(usage, "_today", lambda: "2026-10-08")
    usage.note("alpaca", 2)
    usage.note("nasdaq")
    saved = usage.flush(db, job="nightly")
    assert saved["date"] == "2026-10-08"
    assert saved["calls"] == {"alpaca": 2, "nasdaq": 1}
    assert saved["jobs"]["nightly"] == {"runs": 1, "calls": {"alpaca": 2, "nasdaq": 1}}
    assert usage._counts == {}

    usage.note("alpaca", 3)
    saved = usage.flush(db, job="intraday")
    assert saved["calls"]["alpaca"] == 5
    assert saved["calls"]["nasdaq"] == 1
    assert saved["jobs"]["nightly"]["calls"]["alpaca"] == 2
    assert saved["jobs"]["intraday"] == {"runs": 1, "calls": {"alpaca": 3}}

    usage.note("alpaca", 1)
    saved = usage.flush(db, job="intraday")
    assert saved["jobs"]["intraday"]["runs"] == 2
    assert saved["jobs"]["intraday"]["calls"]["alpaca"] == 4

    monkeypatch.setattr(usage, "_today", lambda: "2026-10-09")
    usage.note("finnhub", 1)
    saved = usage.flush(db, job="premarket")
    assert saved["date"] == "2026-10-09"
    assert saved["calls"] == {"finnhub": 1}
    assert "nightly" not in saved["jobs"]
    assert saved["jobs"]["premarket"]["calls"] == {"finnhub": 1}

    saved = usage.flush(db)
    assert saved["calls"] == {"finnhub": 1}


def test_flush_without_database_keeps_counts(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    usage.reset()
    usage.note("alpaca", 4)
    assert usage.flush() is None
    assert usage._counts["alpaca"] == 4
    usage.reset()
