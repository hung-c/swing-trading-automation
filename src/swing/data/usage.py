"""Live API call counts for the dashboard.

Counts are in-memory until `flush` merges them into the journal kv key `api_usage`.
Cached HTTP responses are not counted. Key values are never stored — only whether
each secret was present on the machine that flushed.
"""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import urlparse

log = logging.getLogger(__name__)

# Providers that need a secret. Empty tuples are not listed; keyless sources stay out of `secrets`.
KEYED: dict[str, tuple[str, ...]] = {
    "alpaca": ("ALPACA_KEY", "ALPACA_SECRET"),
    "massive": ("MASSIVE_KEY",),
    "finnhub": ("FINNHUB_KEY",),
    "alphavantage": ("ALPHAVANTAGE_KEY",),
    "sec": ("SEC_USER_AGENT",),
    "fred": ("FRED_KEY",),
    "groq": ("GROQ_KEY",),
    "gemini": ("GEMINI_KEY",),
    "telegram": ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"),
}

_HOSTS: tuple[tuple[str, str], ...] = (
    ("finnhub.io", "finnhub"),
    ("alphavantage.co", "alphavantage"),
    ("massive.com", "massive"),
    ("polygon.io", "massive"),
    ("nasdaqtrader.com", "nasdaq"),
    ("nasdaq.com", "nasdaq"),
    ("sec.gov", "sec"),
    ("stlouisfed.org", "fred"),
    ("bea.gov", "bea"),
    ("bls.gov", "bls"),
    ("groq.com", "groq"),
    ("googleapis.com", "gemini"),
    ("telegram.org", "telegram"),
    ("yahoo.com", "yfinance"),
)

# Workflow commands whose call counts are stored separately in Neon.
JOBS = ("nightly", "premarket", "intraday", "report")

_counts: dict[str, int] = {}


def reset() -> None:
    _counts.clear()


def note(provider: str, n: int = 1) -> None:
    if n <= 0 or not provider:
        return
    _counts[provider] = _counts.get(provider, 0) + n


def provider_for_url(url: str) -> str | None:
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return None
    for suffix, pid in _HOSTS:
        if host == suffix or host.endswith("." + suffix):
            return pid
    return None


def _today() -> str:
    from swing.calendars import today_et

    return today_et().isoformat()


def flush(path: Path | None = None, job: str | None = None) -> dict | None:
    """Merge this process's counts into today's kv row. Returns the stored payload, or None if it was not written.

    ``job`` is the workflow name (nightly, premarket, intraday, report). Those buckets are what the
    dashboard shows per column. ``swing check`` refreshes key status and leaves the buckets alone.
    """
    from swing import journal
    from swing.config import has_env

    if path is None and not journal.database_url():
        return None
    today = _today()
    try:
        existing = journal.kv_get("api_usage", path=path) or {}
    except Exception as e:  # noqa: BLE001
        log.warning("api usage read failed: %s", e)
        return None
    if not isinstance(existing, dict):
        existing = {}
    same_day = existing.get("date") == today
    calls = dict(existing.get("calls") or {}) if same_day else {}
    jobs = dict(existing.get("jobs") or {}) if same_day else {}
    for pid, n in _counts.items():
        calls[pid] = int(calls.get(pid, 0)) + int(n)
    if job in JOBS:
        bucket = dict(jobs.get(job) or {})
        bucket_calls = dict(bucket.get("calls") or {})
        for pid, n in _counts.items():
            bucket_calls[pid] = int(bucket_calls.get(pid, 0)) + int(n)
        bucket["runs"] = int(bucket.get("runs") or 0) + 1
        bucket["calls"] = bucket_calls
        jobs[job] = bucket
    payload = {
        "date": today,
        "calls": calls,
        "jobs": jobs,
        "secrets": {pid: has_env(*names) for pid, names in KEYED.items()},
    }
    try:
        journal.kv_set("api_usage", payload, path=path)
    except Exception as e:  # noqa: BLE001
        log.warning("api usage write failed: %s", e)
        return None
    _counts.clear()
    return payload
