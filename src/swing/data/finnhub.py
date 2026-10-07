"""Finnhub free tier: earnings calendar (whole US market per call, `hour` = bmo/amc), company news, profile2."""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta

from swing.config import env
from swing.data.http import get
from swing.models import EarningsInfo, NewsItem

log = logging.getLogger(__name__)
BASE = "https://finnhub.io/api/v1"


def available() -> bool:
    return bool(env("FINNHUB_KEY"))


def earnings_calendar(start: date, end: date) -> dict[str, EarningsInfo]:
    """All US tickers reporting in [start, end]. One call. Cached 6 h."""
    if not available():
        return {}
    try:
        data = get(
            f"{BASE}/calendar/earnings",
            params={"from": start.isoformat(), "to": end.isoformat(), "token": env("FINNHUB_KEY")},
            ttl_seconds=6 * 3600,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("finnhub earnings calendar failed: %s", e)
        return {}
    out: dict[str, EarningsInfo] = {}
    for r in data.get("earningsCalendar", []):
        sym = r.get("symbol")
        d = r.get("date")
        if not sym or not d:
            continue
        hour = r.get("hour") or "unknown"
        if hour not in {"bmo", "amc", "dmh"}:
            hour = "unknown"
        info = EarningsInfo(symbol=sym, date=date.fromisoformat(d), hour=hour, source="finnhub")
        # keep the earliest upcoming date per symbol
        if sym not in out or (info.date and out[sym].date and info.date < out[sym].date):
            out[sym] = info
    return out


def company_news(symbol: str, days: int, limit: int = 20) -> list[NewsItem]:
    if not available():
        return []
    to = date.today()
    frm = to - timedelta(days=days)
    try:
        rows = get(
            f"{BASE}/company-news",
            params={"symbol": symbol, "from": frm.isoformat(), "to": to.isoformat(), "token": env("FINNHUB_KEY")},
            ttl_seconds=3600,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("finnhub news %s failed: %s", symbol, e)
        return []
    out = []
    for r in rows[:limit]:
        out.append(
            NewsItem(
                symbol=symbol,
                headline=r.get("headline", ""),
                source=r.get("source", ""),
                url=r.get("url", ""),
                published=datetime.fromtimestamp(r.get("datetime", 0), tz=UTC) if r.get("datetime") else None,
                summary=(r.get("summary") or "")[:400],
                provider="finnhub",
            )
        )
    return out


def profile(symbol: str) -> dict:
    if not available():
        return {}
    try:
        return get(f"{BASE}/stock/profile2", params={"symbol": symbol, "token": env("FINNHUB_KEY")}, ttl_seconds=7 * 86400)
    except Exception as e:  # noqa: BLE001
        log.warning("finnhub profile %s failed: %s", symbol, e)
        return {}
