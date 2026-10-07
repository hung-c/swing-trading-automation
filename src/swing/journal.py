"""SQLite journal: plans, positions, alerts, briefs. Source of truth; Notion is a mirror.

The file state/journal.sqlite is committed back to the repo by the GitHub Actions workflow.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path

from swing.config import ROOT, load_config
from swing.models import Alert, PlanCard, Position

SCHEMA = """
CREATE TABLE IF NOT EXISTS plans (
  plan_date TEXT NOT NULL, symbol TEXT NOT NULL, pattern TEXT, resistance REAL, entry REAL, stop REAL,
  shares INTEGER, target_2r REAL, status TEXT, quality REAL, trend_score INTEGER, sector TEXT, earnings_date TEXT,
  payload TEXT, PRIMARY KEY (plan_date, symbol));
CREATE TABLE IF NOT EXISTS positions (
  symbol TEXT PRIMARY KEY, opened TEXT, entry REAL, stop REAL, initial_stop REAL, shares REAL, target_2r REAL,
  pattern TEXT, sector TEXT, half_sold INTEGER DEFAULT 0, closed TEXT, exit_price REAL, r_multiple REAL, resistance REAL);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT, opened TEXT, closed TEXT, entry REAL, initial_stop REAL,
  exit_price REAL, shares REAL, r_multiple REAL, pattern TEXT, sector TEXT);
CREATE TABLE IF NOT EXISTS alerts (
  ts TEXT, symbol TEXT, condition TEXT, price REAL, rvol REAL, vwap REAL, actionable INTEGER, message TEXT,
  PRIMARY KEY (ts, symbol, condition));
CREATE TABLE IF NOT EXISTS briefs (brief_date TEXT, kind TEXT, notion_page_id TEXT, payload TEXT, PRIMARY KEY (brief_date, kind));
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
"""


def db_path() -> Path:
    p = ROOT / load_config().paths.state_dir
    p.mkdir(parents=True, exist_ok=True)
    return p / "journal.sqlite"


@contextmanager
def connect(path: Path | None = None):
    con = sqlite3.connect(path or db_path())
    con.row_factory = sqlite3.Row
    try:
        con.executescript(SCHEMA)
        yield con
        con.commit()
    finally:
        con.close()


# ---------- plans ----------
def save_plans(plan_date: date, plans: list[PlanCard], path: Path | None = None) -> None:
    with connect(path) as con:
        for p in plans:
            con.execute(
                "INSERT OR REPLACE INTO plans VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    plan_date.isoformat(), p.symbol, p.pattern, p.resistance, p.entry, p.stop, p.shares, p.target_2r,
                    p.status, p.pattern_quality, p.trend_score, p.sector,
                    p.earnings.date.isoformat() if p.earnings and p.earnings.date else None,
                    p.model_dump_json(),
                ),
            )


def latest_plans(status: str = "watch", path: Path | None = None) -> list[PlanCard]:
    """Plans from the most recent plan_date with the given status (the watchlist for today)."""
    with connect(path) as con:
        row = con.execute("SELECT MAX(plan_date) d FROM plans").fetchone()
        if not row or not row["d"]:
            return []
        rows = con.execute("SELECT payload FROM plans WHERE plan_date=? AND status=?", (row["d"], status)).fetchall()
    return [PlanCard.model_validate_json(r["payload"]) for r in rows]


def update_plan_status(plan_date: date, symbol: str, status: str, path: Path | None = None) -> None:
    with connect(path) as con:
        r = con.execute("SELECT payload FROM plans WHERE plan_date=? AND symbol=?", (plan_date.isoformat(), symbol)).fetchone()
        if not r:
            return
        p = PlanCard.model_validate_json(r["payload"])
        p.status = status
        con.execute("UPDATE plans SET status=?, payload=? WHERE plan_date=? AND symbol=?", (status, p.model_dump_json(), plan_date.isoformat(), symbol))


# ---------- positions ----------
def open_positions(path: Path | None = None) -> list[Position]:
    with connect(path) as con:
        rows = con.execute("SELECT * FROM positions WHERE closed IS NULL").fetchall()
    return [
        Position(
            symbol=r["symbol"], opened=date.fromisoformat(r["opened"]), entry=r["entry"], stop=r["stop"],
            initial_stop=r["initial_stop"], shares=r["shares"], target_2r=r["target_2r"], pattern=r["pattern"] or "",
            sector=r["sector"], half_sold=bool(r["half_sold"]), resistance=r["resistance"],
        )
        for r in rows
    ]


def upsert_position(p: Position, path: Path | None = None) -> None:
    with connect(path) as con:
        con.execute(
            "INSERT OR REPLACE INTO positions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                p.symbol, p.opened.isoformat(), p.entry, p.stop, p.initial_stop, p.shares, p.target_2r, p.pattern,
                p.sector, int(p.half_sold), p.closed.isoformat() if p.closed else None, p.exit_price, p.r_multiple, p.resistance,
            ),
        )


def close_position(symbol: str, exit_price: float, closed: date, path: Path | None = None) -> Position | None:
    pos = next((p for p in open_positions(path) if p.symbol == symbol), None)
    if not pos:
        return None
    r = (exit_price - pos.entry) / pos.risk_per_share if pos.risk_per_share else None
    pos.closed, pos.exit_price, pos.r_multiple = closed, exit_price, r
    upsert_position(pos, path)
    with connect(path) as con:
        con.execute(
            "INSERT INTO trades (symbol, opened, closed, entry, initial_stop, exit_price, shares, r_multiple, pattern, sector) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (pos.symbol, pos.opened.isoformat(), closed.isoformat(), pos.entry, pos.initial_stop, exit_price, pos.shares, r, pos.pattern, pos.sector),
        )
    return pos


def heat_pct(account_size: float, positions: list[Position] | None = None, path: Path | None = None) -> float:
    positions = positions if positions is not None else open_positions(path)
    return sum(p.open_risk_usd() for p in positions) / account_size * 100.0 if account_size else 0.0


# ---------- alerts / briefs / kv ----------
def save_alerts(alerts: list[Alert], path: Path | None = None) -> list[Alert]:
    """Insert alerts; returns only the ones that were new (dedupe on ts-minute/symbol/condition)."""
    new = []
    with connect(path) as con:
        for a in alerts:
            key_ts = a.ts.strftime("%Y-%m-%d")  # one alert per condition per symbol per day
            try:
                con.execute(
                    "INSERT INTO alerts VALUES (?,?,?,?,?,?,?,?)",
                    (key_ts, a.symbol, a.condition, a.price, a.rvol, a.vwap, int(a.actionable), a.message),
                )
                new.append(a)
            except sqlite3.IntegrityError:
                continue
    return new


def save_brief(brief_date: date, kind: str, notion_page_id: str | None, payload: dict, path: Path | None = None) -> None:
    with connect(path) as con:
        con.execute(
            "INSERT OR REPLACE INTO briefs VALUES (?,?,?,?)",
            (brief_date.isoformat(), kind, notion_page_id, json.dumps(payload, default=str)),
        )


def kv_get(k: str, default=None, path: Path | None = None):
    with connect(path) as con:
        r = con.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    return json.loads(r["v"]) if r else default


def kv_set(k: str, v, path: Path | None = None) -> None:
    with connect(path) as con:
        con.execute("INSERT OR REPLACE INTO kv VALUES (?,?)", (k, json.dumps(v, default=str)))


def trades(path: Path | None = None) -> list[dict]:
    with connect(path) as con:
        return [dict(r) for r in con.execute("SELECT * FROM trades ORDER BY closed").fetchall()]


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")
