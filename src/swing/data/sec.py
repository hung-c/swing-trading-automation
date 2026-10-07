"""SEC EDGAR (public domain, no key, <=10 req/s, descriptive User-Agent required).

Used as a tiebreaker: ticker -> CIK map, SIC code/description from submissions, shares outstanding from companyfacts.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from swing.config import env
from swing.data.http import get

log = logging.getLogger(__name__)


def _headers() -> dict:
    ua = env("SEC_USER_AGENT") or "swing-trading-personal contact@example.com"
    return {"User-Agent": ua, "Accept-Encoding": "gzip, deflate"}


@lru_cache(maxsize=1)
def ticker_cik_map() -> dict[str, str]:
    try:
        data = get("https://www.sec.gov/files/company_tickers.json", headers=_headers(), ttl_seconds=7 * 86400)
    except Exception as e:  # noqa: BLE001
        log.warning("SEC ticker map failed: %s", e)
        return {}
    return {v["ticker"].upper(): f"{int(v['cik_str']):010d}" for v in data.values()}


def submissions(symbol: str) -> dict:
    cik = ticker_cik_map().get(symbol.upper())
    if not cik:
        return {}
    try:
        return get(f"https://data.sec.gov/submissions/CIK{cik}.json", headers=_headers(), ttl_seconds=7 * 86400)
    except Exception as e:  # noqa: BLE001
        log.warning("SEC submissions %s failed: %s", symbol, e)
        return {}


def sic(symbol: str) -> tuple[str | None, str | None]:
    s = submissions(symbol)
    return s.get("sic"), s.get("sicDescription")


def shares_outstanding(symbol: str) -> float | None:
    cik = ticker_cik_map().get(symbol.upper())
    if not cik:
        return None
    try:
        facts = get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", headers=_headers(), ttl_seconds=7 * 86400)
    except Exception as e:  # noqa: BLE001
        log.warning("SEC companyfacts %s failed: %s", symbol, e)
        return None
    dei = (facts.get("facts") or {}).get("dei", {})
    vals = (dei.get("EntityCommonStockSharesOutstanding") or {}).get("units", {}).get("shares", [])
    if not vals:
        return None
    vals.sort(key=lambda v: v.get("end", ""))
    return float(vals[-1]["val"])
