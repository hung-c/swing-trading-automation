"""Shared HTTP client with retries and a tiny on-disk JSON/text cache."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from swing.config import ROOT, load_config

log = logging.getLogger(__name__)

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


def cache_dir() -> Path:
    p = ROOT / load_config().paths.cache_dir
    p.mkdir(parents=True, exist_ok=True)
    return p


def _key(url: str, params: dict | None) -> str:
    return hashlib.sha1((url + json.dumps(params or {}, sort_keys=True)).encode()).hexdigest()


class RetryableHTTP(Exception):
    pass


@retry(
    reraise=True,
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=1, max=20),
    retry=retry_if_exception_type((RetryableHTTP, httpx.TransportError)),
)
def get(
    url: str,
    params: dict | None = None,
    headers: dict | None = None,
    timeout: float = 30.0,
    ttl_seconds: int | None = None,
    as_json: bool = True,
) -> Any:
    """GET with retries on 429/5xx. If ttl_seconds is given, cache response on disk."""
    cpath = cache_dir() / f"{_key(url, params)}.{'json' if as_json else 'txt'}" if ttl_seconds else None
    if cpath and cpath.exists() and (time.time() - cpath.stat().st_mtime) < ttl_seconds:
        txt = cpath.read_text(encoding="utf-8")
        return json.loads(txt) if as_json else txt

    with httpx.Client(timeout=timeout, follow_redirects=True) as c:
        r = c.get(url, params=params, headers=headers or {})
    if r.status_code == 429 or r.status_code >= 500:
        log.warning("HTTP %s from %s; retrying", r.status_code, url)
        raise RetryableHTTP(f"{r.status_code} {url}")
    r.raise_for_status()
    data = r.json() if as_json else r.text
    if cpath:
        cpath.write_text(r.text, encoding="utf-8")
    return data
