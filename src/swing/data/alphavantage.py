"""Alpha Vantage free tier: 25 requests/day. Budget is tracked in state/av_budget.json.

Used for: EARNINGS_CALENDAR (1 call, whole market CSV) and NEWS_SENTIMENT (<= cfg.news.alphavantage_daily_budget calls).
"""

from __future__ import annotations

import csv
import io
import json
import logging
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from swing.config import ROOT, env, load_config
from swing.data.http import get
from swing.models import EarningsInfo, NewsItem

log = logging.getLogger(__name__)
BASE = "https://www.alphavantage.co/query"
DAILY_CAP = 25


def available() -> bool:
    return bool(env("ALPHAVANTAGE_KEY"))


def _budget_path() -> Path:
    p = ROOT / load_config().paths.state_dir
    p.mkdir(parents=True, exist_ok=True)
    return p / "av_budget.json"


def _spend(n: int = 1) -> bool:
    """Return True if we may spend n more calls today."""
    p = _budget_path()
    today = date.today().isoformat()
    data = {"date": today, "used": 0}
    if p.exists():
        try:
            data = json.loads(p.read_text())
        except Exception:  # noqa: BLE001
            pass
        if data.get("date") != today:
            data = {"date": today, "used": 0}
    if data["used"] + n > DAILY_CAP:
        return False
    data["used"] += n
    p.write_text(json.dumps(data))
    return True


_last_call = 0.0
_premium: set[str] = set()  # functions AV has told us are premium on this key (e.g. NEWS_SENTIMENT since 2026)


def _call(params: dict, as_json: bool = True, ttl: int = 6 * 3600):
    global _last_call
    fn = params.get("function", "")
    if not available() or fn in _premium or not _spend():
        return None
    gap = time.time() - _last_call
    if gap < 1.1:  # free key: 1 request / second
        time.sleep(1.1 - gap)
    _last_call = time.time()
    params = {**params, "apikey": env("ALPHAVANTAGE_KEY")}
    data = get(BASE, params=params, as_json=as_json, ttl_seconds=ttl)
    msg = (data.get("Note") or data.get("Information")) if as_json and isinstance(data, dict) else None
    if not as_json and isinstance(data, str) and data.lstrip().startswith("{"):
        msg = data[:200]
    if msg:
        if "premium" in msg.lower() and "rate limit" not in msg.lower():
            _premium.add(fn)
            log.warning("alphavantage: %s is a premium endpoint on this key; disabled for this run", fn)
        else:
            log.warning("alphavantage throttled: %s", msg[:120])
        return None
    return data


def earnings_calendar(horizon: str = "3month") -> dict[str, EarningsInfo]:
    txt = _call({"function": "EARNINGS_CALENDAR", "horizon": horizon}, as_json=False, ttl=12 * 3600)
    if not txt:
        return {}
    out: dict[str, EarningsInfo] = {}
    for row in csv.DictReader(io.StringIO(txt)):
        sym, d = row.get("symbol"), row.get("reportDate")
        if not sym or not d:
            continue
        try:
            dd = date.fromisoformat(d)
        except ValueError:
            continue
        if sym not in out or dd < out[sym].date:
            out[sym] = EarningsInfo(symbol=sym, date=dd, source="alphavantage")
    return out


def news_sentiment(symbol: str, days: int, limit: int = 20) -> list[NewsItem]:
    t = (datetime.now(UTC) - timedelta(days=days)).strftime("%Y%m%dT%H%M")
    data = _call({"function": "NEWS_SENTIMENT", "tickers": symbol, "time_from": t, "limit": str(limit), "sort": "LATEST"})
    if not data:
        return []
    out: list[NewsItem] = []
    for f in data.get("feed", []):
        score = label = None
        for ts in f.get("ticker_sentiment", []):
            if ts.get("ticker") == symbol:
                score = float(ts.get("ticker_sentiment_score", 0))
                label = ts.get("ticker_sentiment_label")
        pub = None
        try:
            pub = datetime.strptime(f.get("time_published", ""), "%Y%m%dT%H%M%S").replace(tzinfo=UTC)
        except ValueError:
            pass
        out.append(
            NewsItem(
                symbol=symbol,
                headline=f.get("title", ""),
                source=f.get("source", ""),
                url=f.get("url", ""),
                published=pub,
                summary=(f.get("summary") or "")[:400],
                sentiment_score=score,
                sentiment_label=label,
                provider="alphavantage",
            )
        )
    return out
