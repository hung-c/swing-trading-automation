"""Van Tharp trade-log analytics from the SQLite journal: expectancy (mean R), SQN, win rate, by pattern."""

from __future__ import annotations

import math
from collections import defaultdict

from swing import journal
from swing.config import Cfg


def stats(rs: list[float]) -> dict:
    n = len(rs)
    if n == 0:
        return {"n": 0}
    mean = sum(rs) / n
    sd = math.sqrt(sum((r - mean) ** 2 for r in rs) / n) if n > 1 else 0.0
    wins = [r for r in rs if r > 0]
    losses = [r for r in rs if r <= 0]
    sqn = (mean / sd) * math.sqrt(min(n, 100)) if sd > 0 else float("nan")
    return {
        "n": n,
        "expectancy_R": round(mean, 2),
        "sqn": round(sqn, 2) if not math.isnan(sqn) else None,
        "win_rate": round(len(wins) / n * 100, 1),
        "avg_win_R": round(sum(wins) / len(wins), 2) if wins else None,
        "avg_loss_R": round(sum(losses) / len(losses), 2) if losses else None,
        "max_loss_R": round(min(rs), 2),
        "max_win_R": round(max(rs), 2),
    }


def sqn_label(sqn: float | None) -> str:
    if sqn is None:
        return "n/a"
    if sqn < 1.6:
        return "poor"
    if sqn < 2.0:
        return "below average"
    if sqn < 2.5:
        return "average"
    if sqn < 3.0:
        return "good"
    if sqn < 5.0:
        return "excellent"
    return "superb"


def build_report(cfg: Cfg) -> str:
    trades = journal.trades()
    rs_all = [t["r_multiple"] for t in trades if t["r_multiple"] is not None]
    lines = [f"Trades closed: {len(rs_all)}"]
    s = stats(rs_all)
    if s["n"]:
        lines.append(f"All: expectancy {s['expectancy_R']}R, SQN {s['sqn']} ({sqn_label(s['sqn'])}), win rate {s['win_rate']}%, avg win {s['avg_win_R']}R, avg loss {s['avg_loss_R']}R")
        if s["n"] < 30:
            lines.append("Fewer than 30 trades: treat every statistic as noise; do not change rules yet (doc: >=20 trades before changing the exit option).")
    by_pat: dict[str, list[float]] = defaultdict(list)
    for t in trades:
        if t["r_multiple"] is not None:
            by_pat[t["pattern"] or "unknown"].append(t["r_multiple"])
    for pat, rs in sorted(by_pat.items()):
        ps = stats(rs)
        lines.append(f"  {pat}: n={ps['n']} expectancy {ps['expectancy_R']}R win {ps['win_rate']}% SQN {ps['sqn']}")
    positions = journal.open_positions()
    lines.append(f"Open positions: {len(positions)}, heat {journal.heat_pct(cfg.account.size_usd, positions):.1f}% (cap {cfg.account.heat_cap_pct}%)")
    return "\n".join(lines)
