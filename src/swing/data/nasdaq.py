"""US equity universe: Nasdaq Trader symbol directory (authoritative) + Nasdaq.com screener JSON (market cap / sector).

Both are keyless. The screener endpoint is undocumented; we call it 1-3 times per night and cache for 12 h.
"""

from __future__ import annotations

import io
import logging
import re

import pandas as pd

from swing.config import load_config
from swing.data.http import BROWSER_HEADERS, get

log = logging.getLogger(__name__)

NASDAQ_LISTED = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt"
OTHER_LISTED = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt"
SCREENER = "https://api.nasdaq.com/api/screener/stocks"

EXCHANGE_CODES = {"N": "NYSE", "A": "AMEX", "P": "NYSE ARCA", "Z": "BATS", "V": "IEXG"}


def _read_pipe(txt: str) -> pd.DataFrame:
    lines = [ln for ln in txt.splitlines() if ln and not ln.startswith("File Creation Time")]
    return pd.read_csv(io.StringIO("\n".join(lines)), sep="|", dtype=str).fillna("")


def symbol_directory() -> pd.DataFrame:
    """Columns: symbol, name, exchange, is_etf, is_test. Common stocks only after `clean_universe`."""
    nas = _read_pipe(get(NASDAQ_LISTED, as_json=False, ttl_seconds=12 * 3600))
    oth = _read_pipe(get(OTHER_LISTED, as_json=False, ttl_seconds=12 * 3600))
    a = pd.DataFrame(
        {
            "symbol": nas["Symbol"],
            "name": nas["Security Name"],
            "exchange": "NASDAQ",
            "is_etf": nas["ETF"].eq("Y"),
            "is_test": nas["Test Issue"].eq("Y"),
        }
    )
    b = pd.DataFrame(
        {
            "symbol": oth["ACT Symbol"],
            "name": oth["Security Name"],
            "exchange": oth["Exchange"].map(EXCHANGE_CODES).fillna(oth["Exchange"]),
            "is_etf": oth["ETF"].eq("Y"),
            "is_test": oth["Test Issue"].eq("Y"),
        }
    )
    df = pd.concat([a, b], ignore_index=True)
    df["symbol"] = df["symbol"].str.strip()
    return df


def _num(s: str | None) -> float | None:
    if not s:
        return None
    s = str(s).replace("$", "").replace(",", "").replace("%", "").strip()
    if s in {"", "NA", "N/A", "--"}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def screener_table() -> pd.DataFrame:
    """Nasdaq.com screener: symbol, name, last, market_cap, volume, sector, industry, country, ipo_year."""
    headers = {**BROWSER_HEADERS, "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}
    frames = []
    for exch in ("nasdaq", "nyse", "amex"):
        try:
            data = get(
                SCREENER,
                params={"tableonly": "true", "limit": "25", "offset": "0", "download": "true", "exchange": exch},
                headers=headers,
                ttl_seconds=12 * 3600,
            )
            rows = (data.get("data") or {}).get("rows") or []
            frames.append(pd.DataFrame(rows))
        except Exception as e:  # noqa: BLE001
            log.warning("Nasdaq screener (%s) failed: %s", exch, e)
    if not frames:
        return pd.DataFrame(columns=["symbol", "market_cap", "sector", "industry"])
    df = pd.concat(frames, ignore_index=True)
    out = pd.DataFrame(
        {
            "symbol": df["symbol"].str.strip(),
            "scr_name": df.get("name", ""),
            "last": df.get("lastsale", "").map(_num),
            "market_cap": df.get("marketCap", "").map(_num),
            "volume": df.get("volume", "").map(_num),
            "sector": df.get("sector", "").replace("", None),
            "industry": df.get("industry", "").replace("", None),
            "country": df.get("country", ""),
            "ipo_year": df.get("ipoyear", ""),
        }
    )
    return out.drop_duplicates("symbol")


def clean_universe(directory: pd.DataFrame, screener: pd.DataFrame | None = None) -> pd.DataFrame:
    """Drop ETFs, test issues, non-common securities (warrants/units/preferreds/rights/notes), odd symbols."""
    cfg = load_config().universe
    df = directory[~directory["is_etf"] & ~directory["is_test"]].copy()
    df = df[df["exchange"].isin(cfg.exchanges)]
    pat = re.compile("|".join(re.escape(p) for p in cfg.exclude_name_patterns), re.I)
    df = df[~df["name"].str.contains(pat)]
    # Finviz-style symbols: letters only (class shares like BRK.B use '.', keep those), no '$' '^' '~' warrants etc.
    df = df[df["symbol"].str.fullmatch(r"[A-Z]{1,5}(\.[A-Z])?")]
    if screener is not None and not screener.empty:
        df = df.merge(screener[["symbol", "market_cap", "sector", "industry", "last"]], on="symbol", how="left")
    else:
        df["market_cap"] = None
        df["sector"] = None
        df["industry"] = None
        df["last"] = None
    return df.reset_index(drop=True)


def universe(prefilter_cap: float | None = None, prefilter_price: float | None = None) -> pd.DataFrame:
    """Full cleaned universe; optional cheap prefilters on screener fields to cut the bar download."""
    df = clean_universe(symbol_directory(), screener_table())
    n0 = len(df)
    if prefilter_cap is not None:
        df = df[df["market_cap"].fillna(0) >= prefilter_cap]
    if prefilter_price is not None:
        # keep rows with unknown price (None) so we don't drop on a missing field
        df = df[(df["last"].isna()) | (df["last"] >= prefilter_price)]
    log.info("universe: %d cleaned -> %d after prefilters", n0, len(df))
    return df.reset_index(drop=True)
