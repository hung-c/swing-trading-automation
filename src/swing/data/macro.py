"""Macro calendar: BLS ICS (CPI/PPI/Employment Situation), BEA schedule (GDP), FOMC (hard-coded yearly YAML).

Rule from the doc: 8:30 ET releases -> no new entries before 10:00; FOMC 14:00 -> no new entries after 13:30.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta
from pathlib import Path

import yaml

from swing.config import ROOT, load_config
from swing.data.http import get
from swing.models import MacroEvent

log = logging.getLogger(__name__)

BLS_ICS = "https://www.bls.gov/schedule/news_release/bls.ics"
BEA_SCHEDULE_JSON = "https://apps.bea.gov/api/_data/ReleaseSchedule.json"
FOMC_YAML = ROOT / "data" / "fomc.yaml"

BLS_KEEP = {
    "consumer price index": "CPI",
    "producer price index": "PPI",
    "employment situation": "NFP (Employment Situation)",
    "real earnings": None,  # ignore
}
BEA_KEEP = re.compile(r"gross domestic product|personal income and outlays", re.I)


def _unfold_ics(text: str) -> list[str]:
    lines: list[str] = []
    for ln in text.splitlines():
        if ln.startswith((" ", "\t")) and lines:
            lines[-1] += ln[1:]
        else:
            lines.append(ln)
    return lines


def parse_bls_ics(text: str) -> list[MacroEvent]:
    """Minimal VEVENT parser: SUMMARY + DTSTART (local ET; BLS releases are 08:30 unless stated)."""
    events: list[MacroEvent] = []
    cur: dict[str, str] | None = None
    for ln in _unfold_ics(text):
        if ln.startswith("BEGIN:VEVENT"):
            cur = {}
        elif ln.startswith("END:VEVENT") and cur is not None:
            summ = cur.get("SUMMARY", "")
            dt = cur.get("DTSTART", "")
            key = next((v for k, v in BLS_KEEP.items() if k in summ.lower()), None)
            m = re.search(r"(\d{8})(?:T(\d{2})(\d{2}))?", dt)
            if key and m:
                d = datetime.strptime(m.group(1), "%Y%m%d").date()
                t = f"{m.group(2)}:{m.group(3)}" if m.group(2) else "08:30"
                events.append(MacroEvent(name=key, date=d, time_et=t, source="BLS"))
            cur = None
        elif cur is not None and ":" in ln:
            k, v = ln.split(":", 1)
            k = k.split(";")[0]
            cur[k] = v.strip()
    return events


def bls_events() -> list[MacroEvent]:
    try:
        txt = get(BLS_ICS, as_json=False, ttl_seconds=6 * 3600)
        return parse_bls_ics(txt)
    except Exception as e:  # noqa: BLE001
        log.warning("BLS ICS unavailable: %s", e)
        return []


def bea_events() -> list[MacroEvent]:
    """BEA release schedule JSON (GDP, PCE). Falls back silently if the endpoint shape changes."""
    try:
        data = get(BEA_SCHEDULE_JSON, ttl_seconds=6 * 3600)
    except Exception as e:  # noqa: BLE001
        log.warning("BEA schedule unavailable: %s", e)
        return []
    out: list[MacroEvent] = []
    rows = data if isinstance(data, list) else data.get("releases") or data.get("data") or []
    for r in rows:
        if not isinstance(r, dict):
            continue
        title = str(r.get("Title") or r.get("title") or r.get("name") or "")
        if not BEA_KEEP.search(title):
            continue
        raw = str(r.get("ReleaseDate") or r.get("date") or r.get("releaseDate") or "")
        m = re.search(r"(\d{4}-\d{2}-\d{2})|(\d{1,2}/\d{1,2}/\d{4})", raw)
        if not m:
            continue
        d = (
            datetime.strptime(m.group(1), "%Y-%m-%d").date()
            if m.group(1)
            else datetime.strptime(m.group(2), "%m/%d/%Y").date()
        )
        name = "GDP" if "gross" in title.lower() else "PCE (Personal Income & Outlays)"
        out.append(MacroEvent(name=name, date=d, time_et="08:30", source="BEA"))
    return out


def fomc_events(path: Path = FOMC_YAML) -> list[MacroEvent]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    out: list[MacroEvent] = []
    for d in raw.get("decision_days", []):
        dd = d if isinstance(d, date) else datetime.strptime(str(d), "%Y-%m-%d").date()
        out.append(MacroEvent(name="FOMC decision", date=dd, time_et="14:00", source="Federal Reserve"))
    return out


def apply_rules(events: list[MacroEvent]) -> list[MacroEvent]:
    cfg = load_config().intraday
    for e in events:
        if e.name.startswith("FOMC"):
            e.no_new_entries_after = cfg.fomc_no_entry_after
        elif e.time_et <= "09:30":
            e.no_new_entries_before = cfg.macro_no_entry_until
    return events


def all_events(start: date, end: date) -> list[MacroEvent]:
    ev = bls_events() + bea_events() + fomc_events()
    ev = [e for e in ev if start <= e.date <= end]
    ev.sort(key=lambda e: (e.date, e.time_et))
    return apply_rules(ev)


def events_today_and_week(today: date) -> tuple[list[MacroEvent], list[MacroEvent]]:
    week = all_events(today, today + timedelta(days=7))
    return [e for e in week if e.date == today], week
