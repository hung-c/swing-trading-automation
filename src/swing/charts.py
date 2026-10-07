"""Headless chart PNGs (mplfinance/Agg) replicating the doc's three Webull layouts:
Weekly 3y, Daily 6mo, 15-min 5d + VWAP. All with EMA8/EMA21/SMA50/SMA200 + volume; lines for resistance/entry/stop/2R.
"""

from __future__ import annotations

import logging
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import mplfinance as mpf  # noqa: E402
import pandas as pd  # noqa: E402

from swing.config import ROOT, load_config  # noqa: E402
from swing.indicators import ema, session_vwap, sma  # noqa: E402
from swing.models import PlanCard  # noqa: E402

log = logging.getLogger(__name__)

STYLE = mpf.make_mpf_style(base_mpf_style="yahoo", gridstyle=":", y_on_right=True, rc={"font.size": 8})


def _out_dir(day: str) -> Path:
    p = ROOT / load_config().paths.out_dir / "charts" / day
    p.mkdir(parents=True, exist_ok=True)
    return p


def _ohlc(df: pd.DataFrame) -> pd.DataFrame:
    d = df.rename(columns={"open": "Open", "high": "High", "low": "Low", "close": "Close", "volume": "Volume"})
    return d[["Open", "High", "Low", "Close", "Volume"]]


def _levels(plan: PlanCard | None) -> dict | None:
    if not plan:
        return None
    return dict(
        hlines=[plan.resistance, plan.entry, plan.stop, plan.target_2r],
        colors=["orange", "green", "red", "blue"],
        linestyle=["--", "-", "-", ":"],
        linewidths=[1.0, 0.8, 1.0, 0.8],
    )


def _ma_plots(close: pd.Series, full_close: pd.Series | None = None):
    """EMA8/EMA21/SMA50/SMA200 computed on the full series (so the window start isn't NaN), then sliced."""
    src = full_close if full_close is not None else close
    plots = []
    for fn, n, color in ((ema, 8, "#d62728"), (ema, 21, "#9467bd"), (sma, 50, "#1f77b4"), (sma, 200, "#2ca02c")):
        s = fn(src, n).reindex(close.index)
        if s.notna().sum() > 2:
            plots.append(mpf.make_addplot(s, color=color, width=0.8))
    return plots


def daily_chart(symbol: str, df: pd.DataFrame, plan: PlanCard | None, day: str) -> Path:
    cfg = load_config().charts
    win = df.iloc[-int(cfg.daily_months * 21) :]
    path = _out_dir(day) / f"{symbol}_daily.png"
    title = f"{symbol} daily {cfg.daily_months}mo" + (f" | {plan.pattern.replace('_', ' ')} | R ${plan.resistance:.2f} S ${plan.stop:.2f} T ${plan.target_2r:.2f}" if plan else "")
    kw = dict(type="candle", volume=True, style=STYLE, title=title, addplot=_ma_plots(win["close"], df["close"]), figsize=(11, 6), tight_layout=True, savefig=dict(fname=str(path), dpi=cfg.dpi))
    if plan:
        kw["hlines"] = _levels(plan)
        lo = min(float(win["low"].min()), plan.stop) * 0.985
        hi = max(float(win["high"].max()), plan.target_2r) * 1.015
        kw["ylim"] = (lo, hi)
    mpf.plot(_ohlc(win), **kw)
    return path


def weekly_chart(symbol: str, df: pd.DataFrame, plan: PlanCard | None, day: str) -> Path:
    from swing.data.bars import weekly

    cfg = load_config().charts
    wk = weekly(df).iloc[-int(cfg.weekly_years * 52) :]
    path = _out_dir(day) / f"{symbol}_weekly.png"
    plots = []
    m30 = sma(wk["close"], 30)
    if m30.notna().sum() > 2:
        plots.append(mpf.make_addplot(m30, color="#1f77b4", width=0.9))
    kw = dict(type="candle", volume=True, style=STYLE, title=f"{symbol} weekly {cfg.weekly_years}y (30w MA)", addplot=plots or None, figsize=(11, 6), tight_layout=True, savefig=dict(fname=str(path), dpi=cfg.dpi))
    if plan:
        kw["hlines"] = dict(hlines=[plan.resistance], colors=["orange"], linestyle=["--"], linewidths=[1.0])
    if kw["addplot"] is None:
        kw.pop("addplot")
    mpf.plot(_ohlc(wk), **kw)
    return path


def intraday_chart(symbol: str, intra: pd.DataFrame, plan: PlanCard | None, day: str, yesterday_close: float | None = None) -> Path | None:
    cfg = load_config().charts
    if intra is None or intra.empty:
        return None
    path = _out_dir(day) / f"{symbol}_15m.png"
    d = intra.copy()
    d.index = pd.to_datetime(d.index)
    vwap = session_vwap(d)
    plots = [mpf.make_addplot(vwap, color="#ff7f0e", width=1.0)]
    hl = [plan.resistance] if plan else []
    colors = ["orange"] if plan else []
    if yesterday_close:
        hl.append(yesterday_close)
        colors.append("gray")
    kw = dict(type="candle", volume=True, style=STYLE, title=f"{symbol} {cfg.intraday_interval_min}m / {cfg.intraday_days}d + VWAP", addplot=plots, figsize=(11, 6), tight_layout=True, savefig=dict(fname=str(path), dpi=cfg.dpi), datetime_format="%m-%d %H:%M")
    if hl:
        kw["hlines"] = dict(hlines=hl, colors=colors, linestyle=["--"] * len(hl), linewidths=[0.9] * len(hl))
    mpf.plot(_ohlc(d), **kw)
    return path


def charts_for_plan(plan: PlanCard, df: pd.DataFrame, day: str, intra: pd.DataFrame | None = None) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        out["weekly"] = str(weekly_chart(plan.symbol, df, plan, day))
        out["daily"] = str(daily_chart(plan.symbol, df, plan, day))
        if intra is not None and not intra.empty:
            p = intraday_chart(plan.symbol, intra, plan, day, float(df["close"].iloc[-1]))
            if p:
                out["intraday"] = str(p)
    except Exception as e:  # noqa: BLE001
        log.warning("chart %s failed: %s", plan.symbol, e)
    return out
