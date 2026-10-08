"""Journal: plans, positions, trades, alerts, briefs, charts, kv.

Backend is chosen at connect time:
  * DATABASE_URL set  -> Postgres (Neon). Shared with the Vercel web app (web/). Schema: db/schema.sql.
  * otherwise         -> local SQLite at state/journal.sqlite (dev and tests).
An explicit `path` always means SQLite (used by tests).

SQL here is written to run on both: `?` placeholders (translated for Postgres) and ON CONFLICT upserts.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from swing.config import ROOT, env, load_config
from swing.models import Alert, PlanCard, Position

log = logging.getLogger(__name__)

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS plans (
  plan_date TEXT NOT NULL, symbol TEXT NOT NULL, pattern TEXT, resistance REAL, entry REAL, stop REAL,
  shares INTEGER, target_2r REAL, status TEXT, quality REAL, trend_score INTEGER, sector TEXT, earnings_date TEXT,
  payload TEXT NOT NULL, PRIMARY KEY (plan_date, symbol));
CREATE TABLE IF NOT EXISTS positions (
  symbol TEXT PRIMARY KEY, opened TEXT, entry REAL, stop REAL, initial_stop REAL, shares REAL, target_2r REAL,
  pattern TEXT, sector TEXT, half_sold INTEGER DEFAULT 0, closed TEXT, exit_price REAL, r_multiple REAL, resistance REAL);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT, opened TEXT, closed TEXT, entry REAL, initial_stop REAL,
  exit_price REAL, shares REAL, r_multiple REAL, pattern TEXT, sector TEXT);
CREATE TABLE IF NOT EXISTS alerts (
  day TEXT NOT NULL, ts TEXT NOT NULL, symbol TEXT NOT NULL, condition TEXT NOT NULL, price REAL, rvol REAL, vwap REAL,
  actionable INTEGER, message TEXT, PRIMARY KEY (day, symbol, condition));
CREATE TABLE IF NOT EXISTS briefs (
  brief_date TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT, PRIMARY KEY (brief_date, kind));
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS charts (
  day TEXT NOT NULL, symbol TEXT NOT NULL, kind TEXT NOT NULL, png BLOB NOT NULL, PRIMARY KEY (day, symbol, kind));
"""

_PG_READY: set[str] = set()


def database_url() -> str | None:
    return env("DATABASE_URL") or None


def backend() -> str:
    return "postgres" if database_url() else "sqlite"


def db_path() -> Path:
    p = ROOT / load_config().paths.state_dir
    p.mkdir(parents=True, exist_ok=True)
    return p / "journal.sqlite"


class Db:
    """Minimal uniform wrapper: dict rows, `?` placeholders, one code path for both backends."""

    def __init__(self, con, pg: bool):
        self.con, self.pg = con, pg

    def execute(self, sql: str, params: tuple | list = ()):
        if self.pg:
            sql = sql.replace("?", "%s")
        return self.con.execute(sql, tuple(params))

    def one(self, sql: str, params: tuple | list = ()) -> dict | None:
        r = self.execute(sql, params).fetchone()
        return dict(r) if r is not None else None

    def all(self, sql: str, params: tuple | list = ()) -> list[dict]:
        return [dict(r) for r in self.execute(sql, params).fetchall()]


def _sql_statements(sql: str) -> list[str]:
    """Split schema.sql into single statements (psycopg execute() is one-at-a-time)."""
    out, buf = [], []
    for line in sql.splitlines():
        s = line.strip()
        if not s or s.startswith("--"):
            continue
        buf.append(line)
        if s.endswith(";"):
            stmt = "\n".join(buf).strip().rstrip(";")
            if stmt:
                out.append(stmt)
            buf = []
    if buf:
        stmt = "\n".join(buf).strip().rstrip(";")
        if stmt:
            out.append(stmt)
    return out


def init_postgres(url: str) -> None:
    import psycopg

    sql = (ROOT / "db" / "schema.sql").read_text(encoding="utf-8")
    with psycopg.connect(url, autocommit=True) as con:
        for stmt in _sql_statements(sql):
            con.execute(stmt)  # type: ignore[arg-type]
    _PG_READY.add(url)


def _sqlite_cols(con: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})").fetchall()}


def migrate_sqlite(con: sqlite3.Connection) -> None:
    """CREATE IF NOT EXISTS cannot add columns; rebuild leftover tables from the Notion-era sqlite file."""
    con.executescript(SQLITE_SCHEMA)
    if "day" not in _sqlite_cols(con, "alerts"):
        con.execute("ALTER TABLE alerts RENAME TO alerts_old")
        con.execute(
            """CREATE TABLE alerts (
              day TEXT NOT NULL, ts TEXT NOT NULL, symbol TEXT NOT NULL, condition TEXT NOT NULL,
              price REAL, rvol REAL, vwap REAL, actionable INTEGER, message TEXT,
              PRIMARY KEY (day, symbol, condition))"""
        )
        con.execute(
            """INSERT OR IGNORE INTO alerts (day, ts, symbol, condition, price, rvol, vwap, actionable, message)
               SELECT substr(ts, 1, 10), ts, symbol, condition, price, rvol, vwap, actionable, message FROM alerts_old"""
        )
        con.execute("DROP TABLE alerts_old")
        log.info("sqlite: migrated alerts (added day)")
    if "created_at" not in _sqlite_cols(con, "briefs"):
        con.execute("ALTER TABLE briefs RENAME TO briefs_old")
        con.execute(
            """CREATE TABLE briefs (
              brief_date TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT,
              PRIMARY KEY (brief_date, kind))"""
        )
        con.execute(
            """INSERT OR IGNORE INTO briefs (brief_date, kind, payload, created_at)
               SELECT brief_date, kind, COALESCE(payload, '{}'), NULL FROM briefs_old"""
        )
        con.execute("DROP TABLE briefs_old")
        log.info("sqlite: migrated briefs (added created_at)")
    if "updated_at" not in _sqlite_cols(con, "kv"):
        con.execute("ALTER TABLE kv RENAME TO kv_old")
        con.execute("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TEXT)")
        con.execute("INSERT OR IGNORE INTO kv (k, v, updated_at) SELECT k, v, NULL FROM kv_old")
        con.execute("DROP TABLE kv_old")
        log.info("sqlite: migrated kv (added updated_at)")


@contextmanager
def connect(path: Path | None = None):
    url = None if path else database_url()
    if url:
        import psycopg
        from psycopg.rows import dict_row

        if url not in _PG_READY:
            init_postgres(url)
        con = psycopg.connect(url, row_factory=dict_row)
        db = Db(con, pg=True)
    else:
        con = sqlite3.connect(path or db_path())
        con.row_factory = sqlite3.Row
        migrate_sqlite(con)
        db = Db(con, pg=False)
    try:
        yield db
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def _json(v):
    """JSONB comes back as python objects from Postgres, TEXT as str from SQLite."""
    return json.loads(v) if isinstance(v, (str, bytes)) else v


def _date(v) -> date | None:
    if v is None or isinstance(v, date):
        return v if not isinstance(v, datetime) else v.date()
    return date.fromisoformat(str(v)[:10])


def _dumps(obj) -> str:
    return json.dumps(obj, default=str)


# ---------- plans ----------
def save_plans(plan_date: date, plans: list[PlanCard], path: Path | None = None) -> None:
    with connect(path) as db:
        for p in plans:
            db.execute(
                """INSERT INTO plans (plan_date, symbol, pattern, resistance, entry, stop, shares, target_2r, status,
                                      quality, trend_score, sector, earnings_date, payload)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT (plan_date, symbol) DO UPDATE SET pattern=excluded.pattern, resistance=excluded.resistance,
                     entry=excluded.entry, stop=excluded.stop, shares=excluded.shares, target_2r=excluded.target_2r,
                     status=excluded.status, quality=excluded.quality, trend_score=excluded.trend_score,
                     sector=excluded.sector, earnings_date=excluded.earnings_date, payload=excluded.payload""",
                (
                    plan_date.isoformat(), p.symbol, p.pattern, p.resistance, p.entry, p.stop, p.shares, p.target_2r,
                    p.status, p.pattern_quality, p.trend_score, p.sector,
                    p.earnings.date.isoformat() if p.earnings and p.earnings.date else None,
                    p.model_dump_json(),
                ),
            )


def latest_plan_date(path: Path | None = None) -> date | None:
    with connect(path) as db:
        r = db.one("SELECT MAX(plan_date) AS d FROM plans")
    return _date(r["d"]) if r else None


def plans_for(plan_date: date, status: str | None = None, path: Path | None = None) -> list[PlanCard]:
    with connect(path) as db:
        if status:
            rows = db.all("SELECT payload FROM plans WHERE plan_date=? AND status=?", (plan_date.isoformat(), status))
        else:
            rows = db.all("SELECT payload FROM plans WHERE plan_date=?", (plan_date.isoformat(),))
    return [PlanCard.model_validate(_json(r["payload"])) for r in rows]


def latest_plans(status: str = "watch", path: Path | None = None) -> list[PlanCard]:
    """Plans from the most recent plan_date with the given status (the watchlist for today)."""
    d = latest_plan_date(path)
    return plans_for(d, status, path) if d else []


def update_plan_status(plan_date: date, symbol: str, status: str, path: Path | None = None) -> None:
    with connect(path) as db:
        r = db.one("SELECT payload FROM plans WHERE plan_date=? AND symbol=?", (plan_date.isoformat(), symbol))
        if not r:
            return
        p = PlanCard.model_validate(_json(r["payload"]))
        p.status = status
        db.execute(
            "UPDATE plans SET status=?, payload=? WHERE plan_date=? AND symbol=?",
            (status, p.model_dump_json(), plan_date.isoformat(), symbol),
        )


# ---------- positions ----------
def _position(r: dict) -> Position:
    return Position(
        symbol=r["symbol"], opened=_date(r["opened"]), entry=r["entry"], stop=r["stop"],
        initial_stop=r["initial_stop"], shares=r["shares"], target_2r=r["target_2r"], pattern=r["pattern"] or "",
        sector=r["sector"], half_sold=bool(r["half_sold"]), resistance=r["resistance"],
        closed=_date(r["closed"]), exit_price=r["exit_price"], r_multiple=r["r_multiple"],
    )


def open_positions(path: Path | None = None) -> list[Position]:
    with connect(path) as db:
        rows = db.all("SELECT * FROM positions WHERE closed IS NULL ORDER BY opened, symbol")
    return [_position(r) for r in rows]


def upsert_position(p: Position, path: Path | None = None) -> None:
    with connect(path) as db:
        db.execute(
            """INSERT INTO positions (symbol, opened, entry, stop, initial_stop, shares, target_2r, pattern, sector,
                                      half_sold, closed, exit_price, r_multiple, resistance)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT (symbol) DO UPDATE SET opened=excluded.opened, entry=excluded.entry, stop=excluded.stop,
                 initial_stop=excluded.initial_stop, shares=excluded.shares, target_2r=excluded.target_2r,
                 pattern=excluded.pattern, sector=excluded.sector, half_sold=excluded.half_sold, closed=excluded.closed,
                 exit_price=excluded.exit_price, r_multiple=excluded.r_multiple, resistance=excluded.resistance""",
            (
                p.symbol, p.opened.isoformat(), p.entry, p.stop, p.initial_stop, p.shares, p.target_2r, p.pattern,
                p.sector, int(p.half_sold), p.closed.isoformat() if p.closed else None, p.exit_price, p.r_multiple,
                p.resistance,
            ),
        )


def close_position(symbol: str, exit_price: float, closed: date, path: Path | None = None) -> Position | None:
    pos = next((p for p in open_positions(path) if p.symbol == symbol), None)
    if not pos:
        return None
    r = (exit_price - pos.entry) / pos.risk_per_share if pos.risk_per_share else None
    pos.closed, pos.exit_price, pos.r_multiple = closed, exit_price, r
    upsert_position(pos, path)
    with connect(path) as db:
        db.execute(
            """INSERT INTO trades (symbol, opened, closed, entry, initial_stop, exit_price, shares, r_multiple, pattern, sector)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (pos.symbol, pos.opened.isoformat(), closed.isoformat(), pos.entry, pos.initial_stop, exit_price,
             pos.shares, r, pos.pattern, pos.sector),
        )
    return pos


def heat_pct(account_size: float, positions: list[Position] | None = None, path: Path | None = None) -> float:
    positions = positions if positions is not None else open_positions(path)
    return sum(p.open_risk_usd() for p in positions) / account_size * 100.0 if account_size else 0.0


# ---------- alerts / briefs / kv ----------
def save_alerts(alerts: list[Alert], path: Path | None = None) -> list[Alert]:
    """Insert alerts; returns only the new ones (one alert per condition per symbol per day)."""
    new = []
    with connect(path) as db:
        for a in alerts:
            cur = db.execute(
                """INSERT INTO alerts (day, ts, symbol, condition, price, rvol, vwap, actionable, message)
                   VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (day, symbol, condition) DO NOTHING""",
                (a.ts.strftime("%Y-%m-%d"), a.ts.isoformat(), a.symbol, a.condition, a.price, a.rvol, a.vwap,
                 int(a.actionable), a.message),
            )
            if cur.rowcount == 1:
                new.append(a)
    return new


def save_brief(brief_date: date, kind: str, payload: dict, path: Path | None = None) -> None:
    with connect(path) as db:
        db.execute(
            """INSERT INTO briefs (brief_date, kind, payload, created_at) VALUES (?,?,?,?)
               ON CONFLICT (brief_date, kind) DO UPDATE SET payload=excluded.payload, created_at=excluded.created_at""",
            (brief_date.isoformat(), kind, _dumps(payload), datetime.now(UTC).isoformat()),
        )


def kv_get(k: str, default=None, path: Path | None = None):
    with connect(path) as db:
        r = db.one("SELECT v FROM kv WHERE k=?", (k,))
    return _json(r["v"]) if r else default


def kv_set(k: str, v, path: Path | None = None) -> None:
    with connect(path) as db:
        db.execute(
            """INSERT INTO kv (k, v, updated_at) VALUES (?,?,?)
               ON CONFLICT (k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at""",
            (k, _dumps(v), datetime.now(UTC).isoformat()),
        )


def trades(path: Path | None = None) -> list[dict]:
    with connect(path) as db:
        return db.all("SELECT * FROM trades ORDER BY closed, id")


# ---------- charts ----------
def save_chart(day: str, symbol: str, kind: str, png: bytes, path: Path | None = None) -> None:
    with connect(path) as db:
        db.execute(
            """INSERT INTO charts (day, symbol, kind, png) VALUES (?,?,?,?)
               ON CONFLICT (day, symbol, kind) DO UPDATE SET png=excluded.png""",
            (day, symbol, kind, png),
        )


def load_chart(day: str, symbol: str, kind: str, path: Path | None = None) -> bytes | None:
    with connect(path) as db:
        r = db.one("SELECT png FROM charts WHERE day=? AND symbol=? AND kind=?", (day, symbol, kind))
    if not r or r["png"] is None:
        return None
    png = r["png"]
    return png.tobytes() if isinstance(png, memoryview) else bytes(png)


def latest_brief(kind: str | None = None, path: Path | None = None) -> dict | None:
    with connect(path) as db:
        if kind:
            r = db.one(
                "SELECT payload FROM briefs WHERE kind=? ORDER BY brief_date DESC, created_at DESC LIMIT 1",
                (kind,),
            )
        else:
            r = db.one("SELECT payload FROM briefs ORDER BY brief_date DESC, created_at DESC LIMIT 1")
    return _json(r["payload"]) if r else None


def prune(keep_days: int = 21, path: Path | None = None) -> None:
    """Drop old charts, alerts and plans to stay well inside the free-tier storage."""
    cutoff = (date.today() - timedelta(days=keep_days)).isoformat()
    with connect(path) as db:
        db.execute("DELETE FROM charts WHERE day < ?", (cutoff,))
        db.execute("DELETE FROM alerts WHERE day < ?", (cutoff,))
        db.execute("DELETE FROM kv WHERE k LIKE ? AND k < ?", ("regime:%", "regime:" + cutoff))


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")
