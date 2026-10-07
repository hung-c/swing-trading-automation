"""NewsAgent: headlines per watchlist ticker. Alpaca (Benzinga) primary, Alpha Vantage sentiment for the top names,
Finnhub company-news fallback, yfinance news as keyless last resort. Flags red-flag keywords for the brief."""

from __future__ import annotations

import logging
import re

from swing.config import Cfg, load_config
from swing.data import alpaca, alphavantage, finnhub
from swing.models import NewsItem, TickerNews

log = logging.getLogger(__name__)

RED_FLAGS = re.compile(
    r"\b(secondary offering|share offering|dilut|downgrade|investigat|lawsuit|class action|SEC probe|guidance cut|"
    r"cuts? (?:its )?(?:outlook|guidance)|misses?|recall|halt|delist|short report|bankrupt|CFO (?:resign|depart)|CEO (?:resign|depart))",
    re.I,
)


def _yf_news(symbol: str, limit: int) -> list[NewsItem]:
    try:
        import yfinance as yf

        items = yf.Ticker(symbol).get_news(count=limit) or []
    except Exception as e:  # noqa: BLE001
        log.debug("yf news %s failed: %s", symbol, e)
        return []
    out = []
    for it in items:
        c = it.get("content", it)
        out.append(
            NewsItem(
                symbol=symbol,
                headline=c.get("title", ""),
                source=(c.get("provider") or {}).get("displayName", "") if isinstance(c.get("provider"), dict) else "",
                url=((c.get("canonicalUrl") or {}).get("url", "") if isinstance(c.get("canonicalUrl"), dict) else c.get("link", "")),
                summary=(c.get("summary") or "")[:400],
                provider="yfinance",
            )
        )
    return out


def _dedupe(items: list[NewsItem]) -> list[NewsItem]:
    seen, out = set(), []
    for it in items:
        key = re.sub(r"\W+", " ", it.headline.lower()).strip()[:80]
        if key and key not in seen:
            seen.add(key)
            out.append(it)
    return out


def run(symbols: list[str], sentiment_symbols: list[str] | None = None, cfg: Cfg | None = None) -> list[TickerNews]:
    cfg = cfg or load_config()
    n = cfg.news
    out: list[TickerNews] = []
    alp: dict[str, list[NewsItem]] = {s: [] for s in symbols}
    if symbols and alpaca.available():
        for it in alpaca.news(symbols, n.lookback_days, limit=50):
            alp.setdefault(it.symbol, []).append(it)
    sentiment_symbols = (sentiment_symbols or symbols)[: n.alphavantage_daily_budget]
    for s in symbols:
        items = list(alp.get(s, []))
        if s in sentiment_symbols and alphavantage.available():
            items += alphavantage.news_sentiment(s, n.lookback_days, limit=20)
        if not items and finnhub.available():
            items = finnhub.company_news(s, n.lookback_days)
        if not items:
            items = _yf_news(s, n.max_headlines_per_ticker)
        items = _dedupe(items)
        items.sort(key=lambda x: x.published.timestamp() if x.published else 0, reverse=True)
        items = items[: n.max_headlines_per_ticker]
        scores = [x.sentiment_score for x in items if x.sentiment_score is not None]
        flags = sorted({m.group(0).lower() for x in items for m in [RED_FLAGS.search(x.headline + " " + x.summary)] if m})
        out.append(TickerNews(symbol=s, items=items, avg_sentiment=(sum(scores) / len(scores)) if scores else None, red_flags=flags))
    log.info("news: %d tickers, %d headlines", len(out), sum(len(t.items) for t in out))
    return out
