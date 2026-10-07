"""NotionPublisher: one parent page + four databases (Daily Briefs, Plans, Positions, Alerts).

Notion API 2025-09-03 (databases own data sources; pages are created under a data_source_id).
Chart PNGs go through the File Upload API (single_part, <= 20 MB; Free workspaces 5 MiB/file).
Ids are persisted in state/notion_ids.json so setup is idempotent.
"""

from __future__ import annotations

import json
import logging
import mimetypes
from datetime import date
from pathlib import Path

from swing.config import ROOT, env, load_config
from swing.models import Alert, DailyBrief, PlanCard, Position

log = logging.getLogger(__name__)

IDS_PATH = ROOT / "state" / "notion_ids.json"
MAX_TEXT = 1900  # Notion rich_text chunk limit is 2000
MAX_CHILDREN = 90  # append limit is 100 per request


def available() -> bool:
    return bool(env("NOTION_TOKEN") and env("NOTION_PARENT_PAGE_ID"))


def _client():
    from notion_client import Client

    return Client(auth=env("NOTION_TOKEN", required=True))


def _ids() -> dict:
    if IDS_PATH.exists():
        return json.loads(IDS_PATH.read_text())
    return {}


def _save_ids(ids: dict) -> None:
    IDS_PATH.parent.mkdir(parents=True, exist_ok=True)
    IDS_PATH.write_text(json.dumps(ids, indent=2))


# ---------- block helpers ----------
def rt(text: str, bold: bool = False, code: bool = False, link: str | None = None) -> dict:
    t = {"type": "text", "text": {"content": text[:MAX_TEXT]}, "annotations": {"bold": bold, "code": code}}
    if link:
        t["text"]["link"] = {"url": link}
    return t


def heading(text: str, level: int = 2) -> dict:
    key = f"heading_{level}"
    return {"object": "block", "type": key, key: {"rich_text": [rt(text)]}}


def para(text: str) -> list[dict]:
    """Paragraphs split into <= 1900-char chunks."""
    out = []
    for i in range(0, max(len(text), 1), MAX_TEXT):
        out.append({"object": "block", "type": "paragraph", "paragraph": {"rich_text": [rt(text[i : i + MAX_TEXT])]}})
    return out


def bullet(text: str, link: str | None = None) -> dict:
    return {"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": [rt(text, link=link)]}}


def todo(text: str) -> dict:
    return {"object": "block", "type": "to_do", "to_do": {"rich_text": [rt(text)], "checked": False}}


def code(text: str) -> dict:
    return {"object": "block", "type": "code", "code": {"rich_text": [rt(text)], "language": "plain text"}}


def callout(text: str, emoji: str = "📌") -> dict:
    return {"object": "block", "type": "callout", "callout": {"rich_text": [rt(text)], "icon": {"type": "emoji", "emoji": emoji}}}


def divider() -> dict:
    return {"object": "block", "type": "divider", "divider": {}}


def image_block(file_upload_id: str, caption: str = "") -> dict:
    return {"object": "block", "type": "image", "image": {"type": "file_upload", "file_upload": {"id": file_upload_id}, "caption": [rt(caption)] if caption else []}}


def upload_file(path: str | Path) -> str | None:
    """Direct upload (single part). Returns the file_upload id or None."""
    p = Path(path)
    if not p.exists() or p.stat().st_size > 5 * 1024 * 1024:
        return None
    try:
        c = _client()
        ctype = mimetypes.guess_type(p.name)[0] or "image/png"
        fu = c.file_uploads.create(mode="single_part", filename=p.name, content_type=ctype)
        with open(p, "rb") as f:
            c.file_uploads.send(file_upload_id=fu["id"], file=(p.name, f, ctype))
        return fu["id"]
    except Exception as e:  # noqa: BLE001
        log.warning("notion upload %s failed: %s", p.name, e)
        return None


# ---------- setup ----------
PROPS = {
    "briefs": {
        "Name": {"title": {}},
        "Date": {"date": {}},
        "Kind": {"select": {"options": [{"name": k} for k in ("nightly", "premarket", "intraday", "eod", "report")]}},
        "Sizing": {"select": {"options": [{"name": k} for k in ("full", "half", "none")]}},
        "Setups": {"number": {}},
        "Heat %": {"number": {"format": "number"}},
        "LLM": {"rich_text": {}},
    },
    "plans": {
        "Name": {"title": {}},
        "Date": {"date": {}},
        "Symbol": {"rich_text": {}},
        "Pattern": {"select": {"options": [{"name": k} for k in ("bull_flag", "flat_base", "ascending_triangle", "cup_handle", "generic_base")]}},
        "Status": {"select": {"options": [{"name": k} for k in ("watch", "rejected", "triggered", "open", "closed")]}},
        "Resistance": {"number": {}},
        "Entry": {"number": {}},
        "Stop": {"number": {}},
        "Stop %": {"number": {}},
        "Shares": {"number": {}},
        "Target 2R": {"number": {}},
        "Quality": {"number": {}},
        "Trend": {"number": {}},
        "RS": {"number": {}},
        "Sector": {"rich_text": {}},
        "Earnings": {"date": {}},
        "Reason": {"rich_text": {}},
    },
    "positions": {
        "Name": {"title": {}},
        "Opened": {"date": {}},
        "Entry": {"number": {}},
        "Stop": {"number": {}},
        "Initial Stop": {"number": {}},
        "Shares": {"number": {}},
        "Target 2R": {"number": {}},
        "Half Sold": {"checkbox": {}},
        "Closed": {"date": {}},
        "Exit": {"number": {}},
        "R": {"number": {}},
        "Pattern": {"rich_text": {}},
        "Sector": {"rich_text": {}},
    },
    "alerts": {
        "Name": {"title": {}},
        "Time": {"date": {}},
        "Symbol": {"rich_text": {}},
        "Condition": {"rich_text": {}},
        "Price": {"number": {}},
        "RVOL": {"number": {}},
        "VWAP": {"number": {}},
        "Actionable": {"checkbox": {}},
    },
}
TITLES = {"briefs": "Daily Briefs", "plans": "Plans", "positions": "Positions / Journal", "alerts": "Alerts"}


def setup() -> dict:
    """Create the parent page and databases if missing. Returns the id map."""
    c = _client()
    ids = _ids()
    parent_id = env("NOTION_PARENT_PAGE_ID", required=True)
    if "root_page" not in ids:
        page = c.pages.create(
            parent={"type": "page_id", "page_id": parent_id},
            properties={"title": {"title": [rt("Swing Trading System")]}},
            children=[callout("Generated by the swing pipeline. Briefs, plans, positions and alerts live in the databases below. Numbers come from code; prose from the LLM.", "🤖")],
        )
        ids["root_page"] = page["id"]
        _save_ids(ids)
        log.info("created root page %s", page["id"])
    for key, title in TITLES.items():
        if f"db_{key}" in ids and f"ds_{key}" in ids:
            continue
        db = c.databases.create(
            parent={"type": "page_id", "page_id": ids["root_page"]},
            title=[rt(title)],
            is_inline=True,
            initial_data_source={"properties": PROPS[key]},
        )
        ids[f"db_{key}"] = db["id"]
        ids[f"ds_{key}"] = db["data_sources"][0]["id"]
        _save_ids(ids)
        log.info("created database %s (%s)", title, db["id"])
    return ids


def cmd_setup(_args) -> int:
    if not available():
        print("NOTION_TOKEN / NOTION_PARENT_PAGE_ID missing")
        return 1
    ids = setup()
    print(json.dumps(ids, indent=2))
    return 0


# ---------- property helpers ----------
def _num(v) -> dict:
    return {"number": None if v is None else float(v)}


def _text(v) -> dict:
    return {"rich_text": [rt(str(v))] if v else []}


def _date(d: date | None) -> dict:
    return {"date": {"start": d.isoformat()} if d else None}


def _select(v) -> dict:
    return {"select": {"name": str(v)} if v else None}


# ---------- publishing ----------
def _find_page(ds_id: str, prop: str, value: str, date_prop: str | None = None, d: date | None = None) -> str | None:
    c = _client()
    flt = {"and": [{"property": prop, "rich_text": {"equals": value}}]}
    if date_prop and d:
        flt["and"].append({"property": date_prop, "date": {"equals": d.isoformat()}})
    res = c.data_sources.query(data_source_id=ds_id, filter=flt, page_size=1)
    results = res.get("results", [])
    return results[0]["id"] if results else None


def upsert_plans(plans: list[PlanCard], d: date) -> None:
    ids = setup()
    c = _client()
    for p in plans:
        props = {
            "Name": {"title": [rt(f"{p.symbol} {d.isoformat()}")]},
            "Date": _date(d),
            "Symbol": _text(p.symbol),
            "Pattern": _select(p.pattern if p.pattern != "none" else None),
            "Status": _select(p.status),
            "Resistance": _num(p.resistance),
            "Entry": _num(p.entry),
            "Stop": _num(p.stop),
            "Stop %": _num(p.stop_pct),
            "Shares": _num(p.shares),
            "Target 2R": _num(p.target_2r),
            "Quality": _num(p.pattern_quality),
            "Trend": _num(p.trend_score),
            "RS": _num(p.rs_rating),
            "Sector": _text(p.sector),
            "Earnings": _date(p.earnings.date if p.earnings else None),
            "Reason": _text(p.rejected_reason or "; ".join(p.notes[:3])),
        }
        pid = _find_page(ids["ds_plans"], "Symbol", p.symbol, "Date", d)
        if pid:
            c.pages.update(page_id=pid, properties=props)
        else:
            c.pages.create(parent={"type": "data_source_id", "data_source_id": ids["ds_plans"]}, properties=props, children=[code(p.card_text())])


def upsert_positions(positions: list[Position]) -> None:
    ids = setup()
    c = _client()
    for p in positions:
        props = {
            "Name": {"title": [rt(p.symbol)]},
            "Opened": _date(p.opened),
            "Entry": _num(p.entry),
            "Stop": _num(p.stop),
            "Initial Stop": _num(p.initial_stop),
            "Shares": _num(p.shares),
            "Target 2R": _num(p.target_2r),
            "Half Sold": {"checkbox": p.half_sold},
            "Closed": _date(p.closed),
            "Exit": _num(p.exit_price),
            "R": _num(p.r_multiple),
            "Pattern": _text(p.pattern),
            "Sector": _text(p.sector),
        }
        res = c.data_sources.query(data_source_id=ids["ds_positions"], filter={"property": "Name", "title": {"equals": p.symbol}}, page_size=1)
        results = res.get("results", [])
        if results:
            c.pages.update(page_id=results[0]["id"], properties=props)
        else:
            c.pages.create(parent={"type": "data_source_id", "data_source_id": ids["ds_positions"]}, properties=props)


def append_alerts(alerts: list[Alert]) -> None:
    if not alerts:
        return
    ids = setup()
    c = _client()
    for a in alerts:
        props = {
            "Name": {"title": [rt(f"{a.symbol} {a.condition} @ {a.price:.2f}")]},
            "Time": {"date": {"start": a.ts.isoformat()}},
            "Symbol": _text(a.symbol),
            "Condition": _text(a.condition),
            "Price": _num(a.price),
            "RVOL": _num(a.rvol),
            "VWAP": _num(a.vwap),
            "Actionable": {"checkbox": a.actionable},
        }
        c.pages.create(parent={"type": "data_source_id", "data_source_id": ids["ds_alerts"]}, properties=props, children=para(a.message) if a.message else None)


def _regime_blocks(brief: DailyBrief) -> list[dict]:
    r = brief.regime
    if not r:
        return []
    b: list[dict] = [heading("Market regime", 2)]
    tbl = (
        f"SPY {r.spy_close:.2f}: above MA50={r.spy_above_50} MA200={r.spy_above_200} (MA50 rising={r.spy_ma50_rising})\n"
        f"QQQ {r.qqq_close:.2f}: above MA50={r.qqq_above_50} MA200={r.qqq_above_200} (MA50 rising={r.qqq_ma50_rising})\n"
        f"Futures ES {r.es_pct if r.es_pct is None else f'{r.es_pct:+.2f}%'} | NQ {r.nq_pct if r.nq_pct is None else f'{r.nq_pct:+.2f}%'}\n"
        f"Distribution days: " + ", ".join(f"{d.symbol} {d.distribution_days} ({d.status})" for d in r.distribution) + "\n"
        f"Breadth: {r.breadth_pct_above_50 if r.breadth_pct_above_50 is None else f'{r.breadth_pct_above_50:.0f}%'} > MA50, "
        f"{r.breadth_pct_above_200 if r.breadth_pct_above_200 is None else f'{r.breadth_pct_above_200:.0f}%'} > MA200 | NH {r.new_highs} / NL {r.new_lows}\n"
        f"Faber 10-mo SMA risk-on: {r.faber_risk_on}"
        if r.spy_close is not None
        else "Index data unavailable."
    )
    b.append(code(tbl))
    emoji = {"full": "🟢", "half": "🟡", "none": "🔴"}[r.sizing]
    b.append(callout(f"SIZING TODAY: {r.sizing.upper()}" + (f" | max new positions: {r.max_new_positions}" if r.max_new_positions is not None else "") + (f" | no new entries before {r.no_new_entries_before}" if r.no_new_entries_before else "") + (f" | no new entries after {r.no_new_entries_after}" if r.no_new_entries_after else ""), emoji))
    for n in r.notes:
        b.append(bullet(n))
    if r.macro_week:
        b.append(heading("Macro calendar (next 7 days)", 3))
        for e in r.macro_week:
            b.append(bullet(f"{e.date.isoformat()} {e.time_et} ET - {e.name}" + (f" (no new entries before {e.no_new_entries_before})" if e.no_new_entries_before else "") + (f" (no new entries after {e.no_new_entries_after})" if e.no_new_entries_after else "")))
    return b


def _plan_blocks(brief: DailyBrief, upload_charts: bool) -> list[dict]:
    b: list[dict] = [heading(f"Watchlist for tomorrow ({len(brief.plans)} plans)", 2)]
    b.append(para(f"Scan A: {brief.screen_count_strict} strict" + (f", ladder step {brief.ladder_step_used} -> {brief.screen_count_final}" if brief.ladder_step_used else f" -> {brief.screen_count_final}") + f"; weekly survivors {brief.weekly_survivors}.")[0])
    if not brief.plans:
        b.append(callout("No setups tonight. No plan = no trade. Most days are no-trade days.", "💤"))
    for p in brief.plans:
        b.append(heading(f"{p.symbol} - {p.pattern.replace('_', ' ')} (quality {p.pattern_quality:.1f}/10, trend {p.trend_score}/8" + (f", RS {p.rs_rating}" if p.rs_rating else "") + ")", 3))
        b.append(code(p.card_text()))
        for n in p.notes[:4]:
            b.append(bullet(n))
        if p.trend_missing:
            b.append(bullet("Trend template missing: " + ", ".join(p.trend_missing)))
        if upload_charts:
            for kind in ("weekly", "daily", "intraday"):
                path = p.chart_paths.get(kind)
                if path:
                    fid = upload_file(path)
                    if fid:
                        b.append(image_block(fid, f"{p.symbol} {kind}"))
    if brief.rejected:
        b.append(heading(f"Rejected at the plan stage ({len(brief.rejected)})", 3))
        for p in brief.rejected[:15]:
            b.append(bullet(f"{p.symbol}: {p.rejected_reason}"))
    return b


def _news_blocks(brief: DailyBrief) -> list[dict]:
    if not brief.news:
        return []
    b: list[dict] = [heading("News", 2)]
    for t in brief.news:
        if not t.items and not t.red_flags:
            continue
        hdr = t.symbol + (f" (avg sentiment {t.avg_sentiment:+.2f})" if t.avg_sentiment is not None else "")
        if t.red_flags:
            hdr += " - RED FLAGS: " + ", ".join(t.red_flags)
        b.append(heading(hdr, 3))
        for it in t.items[:6]:
            b.append(bullet(f"[{it.source}] {it.headline}", link=it.url or None))
    return b


def _ops_blocks(brief: DailyBrief) -> list[dict]:
    b: list[dict] = []
    if brief.positions or brief.manage:
        b.append(heading("Open positions & management", 2))
        if brief.heat_pct is not None:
            b.append(callout(f"Portfolio heat {brief.heat_pct:.1f}% (cap {load_config().account.heat_cap_pct:.0f}%)", "🔥"))
        for p in brief.positions:
            b.append(bullet(f"{p.symbol}: entry {p.entry:.2f} stop {p.stop:.2f} shares {p.shares:g} 2R {p.target_2r:.2f}" + (" (half sold)" if p.half_sold else "")))
        for m in brief.manage:
            b.append(todo(f"{m.symbol}: {m.action.replace('_', ' ').upper()} - {m.reason}" + (f" -> new stop {m.new_stop:.2f}" if m.new_stop else "")))
    if brief.alerts:
        b.append(heading(f"Alerts ({len(brief.alerts)})", 2))
        for a in brief.alerts[:30]:
            b.append(bullet(f"{a.ts:%H:%M} {a.symbol} {a.condition} @ {a.price:.2f}" + (f" RVOL {a.rvol:.2f}" if a.rvol else "") + (" ACTIONABLE" if a.actionable else "")))
    if brief.warnings:
        b.append(heading("Warnings", 3))
        for w in brief.warnings:
            b.append(bullet(w))
    return b


def publish_brief(brief: DailyBrief, upload_charts: bool = True) -> str | None:
    """Create (or replace) the day's brief page. Returns the Notion page id."""
    ids = setup()
    c = _client()
    pr = brief.prose
    title = f"{brief.date.isoformat()} {brief.kind}" + (f" - {pr.headline}" if pr else "")
    props = {
        "Name": {"title": [rt(title[:200])]},
        "Date": _date(brief.date),
        "Kind": _select(brief.kind),
        "Sizing": _select(brief.regime.sizing if brief.regime else None),
        "Setups": _num(len(brief.plans)),
        "Heat %": _num(brief.heat_pct),
        "LLM": _text(brief.llm_provider),
    }
    blocks: list[dict] = []
    if pr:
        blocks += [heading(pr.headline, 1)]
        blocks += para(pr.market_summary)
    blocks += _regime_blocks(brief)
    blocks.append(divider())
    if pr and brief.kind == "nightly":
        blocks += [heading("Commentary", 2)] + para(pr.watchlist_commentary)
    blocks += _plan_blocks(brief, upload_charts) if brief.kind in ("nightly",) else []
    blocks += _news_blocks(brief)
    blocks += _ops_blocks(brief)
    if pr:
        blocks += [heading("Risk notes", 2)] + para(pr.risk_notes)
        if pr.tomorrow_checklist:
            blocks.append(heading("Checklist", 2))
            blocks += [todo(x) for x in pr.tomorrow_checklist]
    blocks.append(para(f"Finviz manual parity: {_finviz_url()}")[0])

    # replace an existing page for the same (date, kind)
    existing = c.data_sources.query(
        data_source_id=ids["ds_briefs"],
        filter={"and": [{"property": "Date", "date": {"equals": brief.date.isoformat()}}, {"property": "Kind", "select": {"equals": brief.kind}}]},
        page_size=1,
    ).get("results", [])
    for old in existing:
        c.pages.update(page_id=old["id"], archived=True)
    page = c.pages.create(parent={"type": "data_source_id", "data_source_id": ids["ds_briefs"]}, properties=props, children=blocks[:MAX_CHILDREN])
    for i in range(MAX_CHILDREN, len(blocks), MAX_CHILDREN):
        c.blocks.children.append(block_id=page["id"], children=blocks[i : i + MAX_CHILDREN])
    log.info("notion brief page %s (%d blocks)", page["id"], len(blocks))
    return page["id"]


def _finviz_url() -> str:
    from swing.agents.screener import finviz_url

    return finviz_url()
