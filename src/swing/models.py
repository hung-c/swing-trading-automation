"""Pydantic data contracts passed between agents. Numbers are computed by code; the LLM only writes prose."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field


class TickerInfo(BaseModel):
    symbol: str
    name: str = ""
    exchange: str = ""
    market_cap: float | None = None
    sector: str | None = None
    industry: str | None = None
    is_etf: bool = False


class EarningsInfo(BaseModel):
    symbol: str
    date: dt.date | None = None
    hour: Literal["bmo", "amc", "dmh", "unknown"] = "unknown"
    is_estimate: bool = False
    source: str = ""
    trading_days_away: int | None = None


class ScreenRow(BaseModel):
    """One ticker after Scan A + extras. All numbers from daily SIP bars."""

    symbol: str
    close: float
    market_cap: float | None = None
    sector: str | None = None
    industry: str | None = None
    avg_vol_63: float
    sma50: float
    sma150: float | None = None
    sma200: float
    sma200_rising: bool | None = None
    high_52w: float
    low_52w: float
    pct_below_52w_high: float
    pct_above_52w_low: float
    weekly_volatility_pct: float
    atr14: float
    adr20_pct: float
    rs_raw: float | None = None
    rs_rating: int | None = None
    trend_template_pass: bool | None = None
    trend_template_fails: list[str] = Field(default_factory=list)
    stage2_weekly: bool | None = None
    earnings: EarningsInfo | None = None
    excluded_reason: str | None = None
    ladder_step: int = 0  # 0 = strict filter, n = passed only after n relaxations


class TrendScore(BaseModel):
    """Doc Step C: 8-question trend template; >=6 continue."""

    price_above_ma200: bool
    ma50_above_ma200: bool
    ema8_above_ema21: bool
    price_above_ema8: bool
    higher_highs: bool
    higher_lows: bool
    volume_drying_in_base: bool
    within_10pct_52w_high: bool

    @property
    def score(self) -> int:
        return sum(int(v) for v in self.model_dump().values())

    @property
    def missing(self) -> list[str]:
        return [k for k, v in self.model_dump().items() if not v]

    @property
    def structural_weak(self) -> bool:
        # doc: missing 5/6/7 (structure) is weaker than missing 1/8
        return not (self.higher_highs and self.higher_lows and self.volume_drying_in_base)


PatternName = Literal["bull_flag", "flat_base", "ascending_triangle", "cup_handle", "generic_base", "none"]


class PatternResult(BaseModel):
    name: PatternName = "none"
    resistance: float | None = None
    base_low: float | None = None
    support_low: float | None = None  # doc stop option 2: higher low inside the base where price bounced
    base_start: dt.date | None = None
    base_bars: int = 0
    base_depth_pct: float | None = None
    prior_run_pct: float | None = None
    vcp_contractions: list[float] = Field(default_factory=list)
    vcp_ok: bool | None = None
    volume_dry_up: bool | None = None
    bbwidth_at_low: bool | None = None
    atr_ratio_10_50: float | None = None
    base_count: int | None = None
    quality_score: float = 0.0  # 0-10
    notes: list[str] = Field(default_factory=list)


class OverheadSupply(BaseModel):
    clear_sky: bool
    dense_zone_low: float | None = None
    dense_zone_high: float | None = None
    dense_pct_above_price: float | None = None
    note: str = ""


class WeeklyCheck(BaseModel):
    rising_right: bool
    above_30w_ma: bool
    ma30w_rising: bool
    near_1y_high: bool
    overhead: OverheadSupply

    @property
    def passed(self) -> bool:
        return self.rising_right and self.above_30w_ma and self.ma30w_rising and self.near_1y_high and self.overhead.clear_sky


class TickerEvaluation(BaseModel):
    """Advisory judgment. Code fills model and prompt_version; the verdict never changes entry, stop, or size."""

    verdict: Literal["take", "watch", "skip"]
    reasons: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    model: str = "template"
    prompt_version: str = ""
    gate: Literal["plan_card", "actionable_alert", "management"] = "plan_card"


class PlanCard(BaseModel):
    symbol: str
    pattern: PatternName
    resistance: float
    entry: float
    stop: float
    risk_per_share: float
    stop_pct: float
    shares: int
    fractional_shares: float
    notional: float
    target_2r: float
    target_3r: float
    atr14: float
    stop_atr_mult: float
    earnings: EarningsInfo | None = None
    sector: str | None = None
    rs_rating: int | None = None
    trend_score: int
    trend_missing: list[str] = Field(default_factory=list)
    pattern_quality: float
    alert_level: float
    status: Literal["watch", "rejected", "triggered", "open", "closed"] = "watch"
    rejected_reason: str | None = None
    notes: list[str] = Field(default_factory=list)
    chart_paths: dict[str, str] = Field(default_factory=dict)
    evaluations: list[TickerEvaluation] = Field(default_factory=list)

    def card_text(self) -> str:
        e = self.earnings
        edays = f"{e.trading_days_away}d" if e and e.trading_days_away is not None else "n/a"
        edate = e.date.isoformat() if e and e.date else "n/a"
        return (
            f"{self.symbol} | {self.pattern.replace('_', ' ')} | quality {self.pattern_quality:.1f}/10 | trend {self.trend_score}/8\n"
            f"Resistance ${self.resistance:.2f} -> Entry ${self.entry:.2f} -> Stop ${self.stop:.2f} ({self.stop_pct:.1f}%, {self.stop_atr_mult:.1f}x ATR)\n"
            f"Risk/share ${self.risk_per_share:.2f} -> Shares {self.shares} (${self.notional:,.0f}) -> 2R ${self.target_2r:.2f} | 3R ${self.target_3r:.2f}\n"
            f"Earnings {edate} ({edays}) | Alert ${self.alert_level:.2f}"
        )


class DistributionState(BaseModel):
    symbol: str
    distribution_days: int
    days: list[dt.date] = Field(default_factory=list)
    rally_day: int | None = None  # day count of current rally attempt
    follow_through: bool = False
    status: Literal["confirmed_uptrend", "under_pressure", "correction"] = "confirmed_uptrend"


class MacroEvent(BaseModel):
    name: str
    date: dt.date
    time_et: str
    no_new_entries_before: str | None = None
    no_new_entries_after: str | None = None
    source: str = ""


class RegimeReport(BaseModel):
    as_of: dt.date
    spy_close: float | None = None
    spy_above_50: bool | None = None
    spy_above_200: bool | None = None
    spy_ma50_rising: bool | None = None
    qqq_close: float | None = None
    qqq_above_50: bool | None = None
    qqq_above_200: bool | None = None
    qqq_ma50_rising: bool | None = None
    es_pct: float | None = None
    nq_pct: float | None = None
    futures_red: bool | None = None
    distribution: list[DistributionState] = Field(default_factory=list)
    breadth_pct_above_50: float | None = None
    breadth_pct_above_200: float | None = None
    new_highs: int | None = None
    new_lows: int | None = None
    faber_risk_on: bool | None = None
    sizing: Literal["full", "half", "none"] = "full"
    max_new_positions: int | None = None
    macro_today: list[MacroEvent] = Field(default_factory=list)
    macro_week: list[MacroEvent] = Field(default_factory=list)
    no_new_entries_before: str | None = None
    no_new_entries_after: str | None = None
    notes: list[str] = Field(default_factory=list)


class NewsItem(BaseModel):
    symbol: str
    headline: str
    source: str = ""
    url: str = ""
    published: dt.datetime | None = None
    summary: str = ""
    sentiment_score: float | None = None
    sentiment_label: str | None = None
    provider: str = ""


class TickerNews(BaseModel):
    symbol: str
    items: list[NewsItem] = Field(default_factory=list)
    avg_sentiment: float | None = None
    red_flags: list[str] = Field(default_factory=list)


class Alert(BaseModel):
    ts: dt.datetime
    symbol: str
    condition: str
    price: float
    resistance: float | None = None
    vwap: float | None = None
    rvol: float | None = None
    above_yesterday_close: bool | None = None
    actionable: bool = False
    message: str = ""


class ManageAction(BaseModel):
    symbol: str
    action: Literal["hold", "exit_failed_breakout", "sell_half_2r", "trail_stop_8ema", "earnings_decision", "stop_hit"]
    reason: str
    new_stop: float | None = None
    price: float | None = None


class Position(BaseModel):
    symbol: str
    opened: dt.date
    entry: float
    stop: float
    initial_stop: float
    shares: float
    target_2r: float
    resistance: float | None = None  # breakout level; "close back inside the base" = close below this
    pattern: str = ""
    sector: str | None = None
    half_sold: bool = False
    closed: dt.date | None = None
    exit_price: float | None = None
    r_multiple: float | None = None

    @property
    def risk_per_share(self) -> float:
        return self.entry - self.initial_stop

    def open_risk_usd(self) -> float:
        return max(0.0, (self.entry - self.stop)) * self.shares


class BriefProse(BaseModel):
    """Validated LLM output. No numbers are trusted from here; they come from the structured data."""

    headline: str = Field(max_length=200)
    market_summary: str = Field(max_length=1500)
    watchlist_commentary: str = Field(max_length=2500)
    risk_notes: str = Field(max_length=1200)
    tomorrow_checklist: list[str] = Field(default_factory=list, max_length=12)


class DailyBrief(BaseModel):
    date: dt.date
    kind: Literal["nightly", "premarket", "intraday", "eod"]
    regime: RegimeReport | None = None
    screen_count_strict: int = 0
    screen_count_final: int = 0
    ladder_step_used: int = 0
    weekly_survivors: int = 0
    plans: list[PlanCard] = Field(default_factory=list)
    rejected: list[PlanCard] = Field(default_factory=list)
    news: list[TickerNews] = Field(default_factory=list)
    alerts: list[Alert] = Field(default_factory=list)
    manage: list[ManageAction] = Field(default_factory=list)
    positions: list[Position] = Field(default_factory=list)
    heat_pct: float | None = None
    prose: BriefProse | None = None
    llm_provider: str = "template"
    warnings: list[str] = Field(default_factory=list)
