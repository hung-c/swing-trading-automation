"""Minimal event-driven backtest of the doc's breakout rules on daily bars (per symbol, no look-ahead).

Caveats you must keep in mind (see plan/research):
- Survivorship bias: the universe is today's survivors; delisted names are missing -> results are optimistic.
- Pivots are confirmed `pivot_window` bars late; patterns are evaluated on data up to the signal bar only.
- Fills: entry at max(open, entry_limit) next day if high >= entry (slippage 0.2%); stop fills at stop - 0.1% or the
  gap-down open; "close back inside base" exit at the close. Half off at 2R, remainder trails under the 8 EMA.
- Fewer than ~100 trades per setup is not conclusive; use the output to sanity-check rules, not to tune thresholds.

    uv run python -m swing.extras.backtest AAPL NVDA ... [--years 3]
"""

from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass

import pandas as pd

from swing.config import load_config
from swing.data import bars
from swing.indicators import atr, ema
from swing.patterns import detect_pattern, quality_score

log = logging.getLogger(__name__)


@dataclass
class Trade:
    symbol: str
    pattern: str
    entry_date: pd.Timestamp
    entry: float
    stop: float
    initial_stop: float = 0.0
    exit_date: pd.Timestamp | None = None
    exit: float | None = None
    r: float | None = None
    half_sold: bool = False
    exit_reason: str = ""


def backtest_symbol(symbol: str, df: pd.DataFrame, cfg, min_quality: float = 5.0, lookback: int = 260) -> list[Trade]:
    trades: list[Trade] = []
    rk = cfg.risk
    pending = None  # (resistance, entry, stop, pattern, expires_at_index)
    open_tr: Trade | None = None
    a14 = atr(df, 14)
    e8 = ema(df["close"], 8)
    for i in range(lookback, len(df) - 1):
        hist = df.iloc[: i + 1]
        today = df.iloc[i]
        nxt = df.iloc[i + 1]

        # manage an open trade on the NEXT bar's data (we decide at today's close, act tomorrow)
        if open_tr:
            risk = open_tr.entry - open_tr.initial_stop
            if nxt["low"] <= open_tr.stop:
                px = min(open_tr.stop * 0.999, nxt["open"]) if nxt["open"] < open_tr.stop else open_tr.stop * 0.999
                open_tr.exit, open_tr.exit_date, open_tr.exit_reason = px, nxt.name, "stop"
            elif not open_tr.half_sold and nxt["high"] >= open_tr.entry + 2 * risk:
                open_tr.half_sold = True
                open_tr.stop = open_tr.entry  # breakeven on the remainder
                open_tr.r = 2.0 * 0.5  # bank half at 2R
            elif open_tr.half_sold and nxt["close"] < e8.iloc[i + 1]:
                open_tr.exit, open_tr.exit_date, open_tr.exit_reason = float(nxt["close"]), nxt.name, "8ema"
            elif not open_tr.half_sold and nxt["close"] < pending_res_of(open_tr):
                open_tr.exit, open_tr.exit_date, open_tr.exit_reason = float(nxt["close"]), nxt.name, "failed_breakout"
            if open_tr.exit is not None:
                remainder_r = (open_tr.exit - open_tr.entry) / risk
                open_tr.r = (open_tr.r or 0.0) + (0.5 if open_tr.half_sold else 1.0) * remainder_r
                trades.append(open_tr)
                open_tr = None
            continue

        # pending entry: fill if tomorrow trades through the limit (no chase beyond +1%)
        if pending:
            res, entry, stop, pat, exp = pending
            if i > exp:
                pending = None
            elif nxt["high"] >= entry and nxt["open"] <= res * (1 + cfg.intraday.no_chase_pct_above_resistance / 100.0):
                fill = max(float(nxt["open"]), entry) * 1.002
                open_tr = Trade(symbol, pat, nxt.name, fill, stop, initial_stop=stop)
                open_tr.__dict__["_res"] = res
                pending = None
                # doc: breakout needs volume >= 1.5x the 50-day average; a low-volume breakout is exited at the close
                avg50 = float(df["volume"].iloc[max(0, i - 49) : i + 1].mean())
                if nxt["volume"] < rk.breakout_volume_mult_min * avg50:
                    open_tr.exit, open_tr.exit_date, open_tr.exit_reason = float(nxt["close"]), nxt.name, "low_volume_breakout"
                    open_tr.r = (open_tr.exit - open_tr.entry) / (open_tr.entry - open_tr.initial_stop)
                    trades.append(open_tr)
                    open_tr = None
                continue

        # new signal only every 5 bars to keep it cheap
        if i % 5:
            continue
        pat = detect_pattern(hist, cfg)
        if pat.name == "none" or not pat.resistance or not pat.base_low:
            continue
        pat = quality_score(hist, pat, cfg)
        if pat.quality_score < min_quality:
            continue
        price = float(today["close"])
        if (pat.resistance / price - 1) * 100 > cfg.patterns.resistance_max_pct_above_price:
            continue
        entry = pat.resistance * (1 + rk.entry_buffer_pct_min / 100)
        stop = pat.base_low - 0.25 * float(a14.iloc[i])
        if (entry - stop) / entry * 100 > rk.stop_max_pct_reduced:
            continue
        pending = (pat.resistance, entry, stop, pat.name, i + 15)
    return trades


def pending_res_of(tr: Trade) -> float:
    return tr.__dict__.get("_res", tr.entry / 1.005)


def summarize(trades: list[Trade]) -> str:
    from swing.extras.report import stats

    rs = [t.r for t in trades if t.r is not None]
    s = stats(rs)
    lines = [f"trades={s.get('n', 0)}"]
    if s.get("n"):
        lines.append(f"expectancy {s['expectancy_R']}R | win {s['win_rate']}% | avg win {s['avg_win_R']}R | avg loss {s['avg_loss_R']}R | SQN {s['sqn']}")
        by = {}
        for t in trades:
            by.setdefault(t.pattern, []).append(t.r)
        for k, v in by.items():
            ps = stats([x for x in v if x is not None])
            lines.append(f"  {k}: n={ps['n']} expectancy {ps['expectancy_R']}R win {ps['win_rate']}%")
        reasons = pd.Series([t.exit_reason for t in trades]).value_counts().to_dict()
        lines.append(f"  exits: {reasons}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("symbols", nargs="+")
    p.add_argument("--years", type=float, default=3.0)
    p.add_argument("--min-quality", type=float, default=5.0)
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.WARNING)
    cfg = load_config()
    frames, prov = bars.daily(args.symbols, years=args.years)
    print(f"bars via {prov}")
    all_trades: list[Trade] = []
    for s, df in frames.items():
        t = backtest_symbol(s, df, cfg, args.min_quality)
        all_trades += t
        print(f"{s}: {len(t)} trades")
    print(summarize(all_trades))
    print("CAVEAT: survivorship-biased universe, simplified fills; do not tune thresholds on this alone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
