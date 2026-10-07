"""Macro calendar for the pre-market blackout rules.

Sources, merged and de-duplicated on (name, date):
- data/macro_static.yaml  : CPI / PPI / NFP hand-maintained from bls.gov (bls.gov 403s scripted clients)
- BLS ICS (best effort)   : https://www.bls.gov/schedule/news_release/bls.ics
- BEA JSON                : https://apps.bea.gov/API/signup/release_dates.json (GDP, PCE; UTC timestamps)
- FRED releases/dates     : optional, needs FRED_KEY (dates only; 08:30 assumed for BLS/BEA releases)
- data/fomc.yaml          : FOMC decision days (14:00 statement)

Rules from the doc: 08:30 release -> no new entries before 10:00; FOMC -> no new entries after 13:30.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from swing.config import ROOT, env, load_config
from swing.data.http import BROWSER_HEADERS, get
from swing.models import MacroEvent

log = logging.getLogger(__name__)
ET = ZoneInfo("America/New_York")

BLS_ICS = "https://www.bls.gov/schedule/news_release/bls.ics"
BEA_JSON = "https://apps.bea.gov/API/signup/release_dates.json"
FRED_RELEASES_DATES = "https://api.stlouisfed.org/fred/releases/dates"
FOMC_YAML = ROOT / "data" / "fomc.yaml"
STATIC_YAML = ROOT / "data" / "macro_static.yaml"

BLS_KEEP = {
    "consumer price index": "CPI",
    "producer price index": "PPI",
    "employment situation": "NFP (Employment Situation)",
}
BEA_KEEP = {"gross domestic product": "GDP", "personal income and outlays": "PCE (Personal Income & Outlays)"}
FRED_KEEP = {
    "consumer price index": "CPI",
    "producer price index": "PPI",
    "employment situation": "NFP (Employment Situation)",
    "gross domestic product": "GDP",
    "personal income and outlays": "PCE (Personal Income & Outlays)",
}


def _classify(summary: str, table: dict[str, str]) -> str | None:
    s = summary.lower()
    return next((v for k, v in table.items() if k in s), None)


def _unfold_ics(text: str) -> list[str]:
    lines: list[str] = []
    for ln in text.splitlines():
        if ln.startswith((" ", "\t")) and lines:
            lines[-1] += ln[1:]
        else:
            lines.append(ln)
    return lines


def parse_ics(text: str, table: dict[str, str], source: str) -> list[MacroEvent]:
    """Minimal VEVENT parser. DTSTART may be local ET (TZID) or UTC (trailing Z)."""
    events: list[MacroEvent] = []
    cur: dict[str, str] | None = None
    for ln in _unfold_ics(text):
        if ln.startswith("BEGIN:VEVENT"):
            cur = {}
        elif ln.startswith("END:VEVENT") and cur is not None:
            name = _classify(cur.get("SUMMARY", ""), table)
            m = re.search(r"(\d{8})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?", cur.get("DTSTART", ""))
            if name and m:
                d = datetime.strptime(m.group(1), "%Y%m%d").date()
                if m.group(2):
                    hh, mm = int(m.group(2)), int(m.group(3))
                    if m.group(5):  # UTC -> ET
                        dt_utc = datetime(d.year, d.month, d.day, hh, mm, tzinfo=ZoneInfo("UTC")).astimezone(ET)
                        d, t = dt_utc.date(), dt_utc.strftime("%H:%M")
                    else:
                        t = f"{hh:02d}:{mm:02d}"
                else:
                    t = "08:30"
                events.append(MacroEvent(name=name, date=d, time_et=t, source=source))
            cur = None
        elif cur is not None and ":" in ln:
            k, v = ln.split(":", 1)
            cur[k.split(";")[0]] = v.strip()
    return events


def static_events(path: Path = STATIC_YAML) -> list[MacroEvent]:
    if not path.exists():
        return []
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out = []
    for r in raw.get("releases", []):
        d = r["date"] if isinstance(r["date"], date) else date.fromisoformat(str(r["date"]))
        out.append(MacroEvent(name=r["name"], date=d, time_et=str(r.get("time_et", "08:30")), source="static"))
    return out


def bls_events() -> list[MacroEvent]:
    try:
        txt = get(BLS_ICS, as_json=False, ttl_seconds=12 * 3600, headers=BROWSER_HEADERS)
        return parse_ics(txt, BLS_KEEP, "BLS")
    except Exception as e:  # noqa: BLE001
        log.info("BLS ICS unavailable (expected from scripts): %s", str(e)[:80])
        return []


def bea_events() -> list[MacroEvent]:
    try:
        data = get(BEA_JSON, ttl_seconds=12 * 3600, headers=BROWSER_HEADERS)
    except Exception as e:  # noqa: BLE001
        log.warning("BEA schedule unavailable: %s", e)
        return []
    out: list[MacroEvent] = []
    for title, body in (data or {}).items():
        name = _classify(title, BEA_KEEP)
        if not name:
            continue
        for ts in (body or {}).get("release_dates", []):
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(ET)
            except ValueError:
                continue
            out.append(MacroEvent(name=name, date=dt.date(), time_et=dt.strftime("%H:%M"), source="BEA"))
    return out


def fred_events(start: date, end: date) -> list[MacroEvent]:
    key = env("FRED_KEY")
    if not key:
        return []
    try:
        data = get(
            FRED_RELEASES_DATES,
            params={
                "api_key": key,
                "file_type": "json",
                "realtime_start": start.isoformat(),
                "realtime_end": end.isoformat(),
                "include_release_dates_with_no_data": "true",
                "limit": "1000",
            },
            ttl_seconds=12 * 3600,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("FRED release dates failed: %s", e)
        return []
    out = []
    for r in data.get("release_dates", []):
        name = _classify(r.get("release_name", ""), FRED_KEEP)
        if name:
            out.append(MacroEvent(name=name, date=date.fromisoformat(r["date"]), time_et="08:30", source="FRED"))
    return out


def fomc_events(path: Path = FOMC_YAML) -> list[MacroEvent]:
    if not path.exists():
        return []
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out = []
    for d in raw.get("decision_days", []):
        dd = d if isinstance(d, date) else date.fromisoformat(str(d))
        out.append(MacroEvent(name="FOMC decision", date=dd, time_et="14:00", source="Federal Reserve"))
    return out


def heuristic_nfp(start: date, end: date, known: set[tuple[str, date]]) -> list[MacroEvent]:
    """If a month has no NFP from any source, assume first Friday 08:30 and mark it estimated."""
    out = []
    d = date(start.year, start.month, 1)
    while d <= end:
        if not any(n.startswith("NFP") and dt.year == d.year and dt.month == d.month for n, dt in known):
            first_fri = d + timedelta(days=(4 - d.weekday()) % 7)
            if start <= first_fri <= end:
                out.append(MacroEvent(name="NFP (Employment Situation) [estimated]", date=first_fri, time_et="08:30", source="heuristic"))
        d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
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
    raw = static_events() + bls_events() + bea_events() + fred_events(start, end) + fomc_events()
    raw = [e for e in raw if start <= e.date <= end]
    seen: dict[tuple[str, date], MacroEvent] = {}
    for e in raw:
        key = (e.name, e.date)
        if key not in seen:
            seen[key] = e
    events = list(seen.values())
    events += heuristic_nfp(start, end, set(seen))
    events.sort(key=lambda e: (e.date, e.time_et))
    return apply_rules(events)


def events_today_and_week(today: date) -> tuple[list[MacroEvent], list[MacroEvent]]:
    week = all_events(today, today + timedelta(days=7))
    return [e for e in week if e.date == today], week
