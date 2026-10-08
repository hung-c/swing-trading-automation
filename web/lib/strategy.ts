/** A strategy is the rule set for one way of trading. Sections follow the nightly pipeline. */

export const STRATEGY_STYLES = ["breakout", "pullback", "hybrid"] as const;
export const STRATEGY_STATUSES = ["draft", "active", "paused"] as const;
export const EXCHANGES = ["NASDAQ", "NYSE", "AMEX"] as const;
export const PATTERN_OPTIONS = [
  ["bull_flag", "Bull flag"],
  ["flat_base", "Flat base"],
  ["ascending_triangle", "Ascending triangle"],
  ["cup_handle", "Cup with handle"],
  ["generic_base", "Generic base"],
] as const;

export type StrategyStyle = (typeof STRATEGY_STYLES)[number];
export type StrategyStatus = (typeof STRATEGY_STATUSES)[number];
export type Exchange = (typeof EXCHANGES)[number];
export type PatternKey = (typeof PATTERN_OPTIONS)[number][0];

export type Strategy = {
  profile: {
    name: string;
    thesis: string;
    style: StrategyStyle;
    horizon_days: number;
    status: StrategyStatus;
  };
  universe: {
    exchanges: Exchange[];
    market_cap_min: number;
    exclude_etfs: boolean;
    max_tickers: number;
  };
  scanner: {
    enabled: boolean;
    price_min: number;
    avg_volume_min: number;
    pct_below_52w_high_max: number;
    weekly_volatility_max: number;
    above_sma50: boolean;
    above_sma200: boolean;
    sma50_above_sma200: boolean;
    earnings_blackout_days: number;
    target_min: number;
    target_max: number;
    ladder_high_pct: number;
    ladder_volatility_max: number;
    ladder_volume_min: number;
    ladder_market_cap_min: number;
  };
  technical: {
    enabled: boolean;
    min_trend_score: number;
    near_high_pct: number;
    patterns: PatternKey[];
    rs_rating_min: number;
    rs_hard_filter: boolean;
    trend_template_hard_filter: boolean;
    vcp_max_ratio: number;
    overhead_lookback_months: number;
    overhead_zone_pct: number;
  };
  risk: {
    account_size_usd: number;
    risk_pct: number;
    heat_cap_pct: number;
    max_positions: number;
    max_per_sector: number;
    max_notional_pct: number;
    stop_max_pct: number;
    stop_max_pct_loose: number;
    min_r: number;
    entry_buffer_min_pct: number;
    entry_buffer_max_pct: number;
  };
  regime: {
    enabled: boolean;
    distribution_pressure: number;
    distribution_correction: number;
    breadth_risk_on_pct: number;
    breadth_risk_off_pct: number;
    futures_red_pct: number;
    respect_macro_blackout: boolean;
  };
  news: {
    enabled: boolean;
    lookback_days: number;
    max_headlines: number;
    earnings_warn_days: number;
    red_flags: string[];
  };
  alerts: {
    enabled: boolean;
    session_start: string;
    session_end: string;
    rvol_min: number;
    no_chase_pct: number;
    require_above_vwap: boolean;
    require_above_prior_close: boolean;
  };
  management: {
    sell_half_at_r: number;
    trail_ema: number;
    earnings_decision_days: number;
    exit_failed_breakout: boolean;
  };
  evaluator: {
    gates: {
      plan_card: boolean;
      actionable_alert: boolean;
      management: boolean;
    };
    direction: string;
    must_pass: string;
    disqualify: string;
    do_not: string;
  };
};

export type StrategySectionId = keyof Strategy;

export const STRATEGY_SECTIONS: { id: StrategySectionId; title: string; summary: string }[] = [
  {
    id: "profile",
    title: "Profile",
    summary: "What this strategy is, how it trades, and how long a winner is expected to be held.",
  },
  {
    id: "universe",
    title: "Universe",
    summary: "Which listings are eligible before any setup is scored.",
  },
  {
    id: "scanner",
    title: "Scanner",
    summary: "Hard filters that build the nightly candidate list, plus the ladder that relaxes them if the list is too short.",
  },
  {
    id: "technical",
    title: "Technical",
    summary: "Trend template, chart patterns, relative strength, and overhead supply. This decides which candidates become plans.",
  },
  {
    id: "risk",
    title: "Risk",
    summary: "Account size, risk per trade, stop distance, and how much open heat the book can carry.",
  },
  {
    id: "regime",
    title: "Regime",
    summary: "Market conditions that size, cut, or block new entries for the day.",
  },
  {
    id: "news",
    title: "News",
    summary: "Headlines and earnings that veto a setup the chart would otherwise pass.",
  },
  {
    id: "alerts",
    title: "Alerts",
    summary: "Intraday trigger: the break, the volume, and the point past which you do not chase.",
  },
  {
    id: "management",
    title: "Management",
    summary: "What happens after the fill: partials, the trail, and the exits.",
  },
  {
    id: "evaluator",
    title: "Evaluator",
    summary: "When an agent reads a name that already cleared the hard rules, and the written direction it must follow.",
  },
];

const DEFAULT_FLAGS = ["offering", "dilution", "investigation", "bankruptcy", "downgrade", "guidance cut"];

/** Stable id for the desk's swing routine. Seeded into strategies so the page can show and edit it. */
export const BUILTIN_STRATEGY_ID = "00000000-0000-4000-8000-000000000001";

/** The current swing routine, used as the starting point for a new strategy. */
export function swingTemplate(): Strategy {
  return {
    profile: {
      name: "",
      thesis: "Buy tight bases near highs when the market trend allows, and risk a fixed percent to a structural stop.",
      style: "breakout",
      horizon_days: 20,
      status: "draft",
    },
    universe: {
      exchanges: ["NASDAQ", "NYSE", "AMEX"],
      market_cap_min: 2_000_000_000,
      exclude_etfs: true,
      max_tickers: 3000,
    },
    scanner: {
      enabled: true,
      price_min: 10,
      avg_volume_min: 1_000_000,
      pct_below_52w_high_max: 10,
      weekly_volatility_max: 3,
      above_sma50: true,
      above_sma200: true,
      sma50_above_sma200: true,
      earnings_blackout_days: 7,
      target_min: 20,
      target_max: 80,
      ladder_high_pct: 20,
      ladder_volatility_max: 5,
      ladder_volume_min: 500_000,
      ladder_market_cap_min: 1_000_000_000,
    },
    technical: {
      enabled: true,
      min_trend_score: 6,
      near_high_pct: 10,
      patterns: ["bull_flag", "flat_base", "ascending_triangle", "cup_handle", "generic_base"],
      rs_rating_min: 70,
      rs_hard_filter: false,
      trend_template_hard_filter: false,
      vcp_max_ratio: 0.75,
      overhead_lookback_months: 24,
      overhead_zone_pct: 10,
    },
    risk: {
      account_size_usd: 5000,
      risk_pct: 1,
      heat_cap_pct: 6,
      max_positions: 6,
      max_per_sector: 2,
      max_notional_pct: 25,
      stop_max_pct: 8,
      stop_max_pct_loose: 12,
      min_r: 2,
      entry_buffer_min_pct: 0.5,
      entry_buffer_max_pct: 1,
    },
    regime: {
      enabled: true,
      distribution_pressure: 5,
      distribution_correction: 7,
      breadth_risk_on_pct: 60,
      breadth_risk_off_pct: 40,
      futures_red_pct: -0.75,
      respect_macro_blackout: true,
    },
    news: {
      enabled: true,
      lookback_days: 7,
      max_headlines: 8,
      earnings_warn_days: 2,
      red_flags: [...DEFAULT_FLAGS],
    },
    alerts: {
      enabled: true,
      session_start: "10:00",
      session_end: "15:50",
      rvol_min: 1.5,
      no_chase_pct: 1,
      require_above_vwap: true,
      require_above_prior_close: true,
    },
    management: {
      sell_half_at_r: 2,
      trail_ema: 8,
      earnings_decision_days: 2,
      exit_failed_breakout: true,
    },
    evaluator: {
      gates: { plan_card: true, actionable_alert: false, management: false },
      direction:
        "A good name is a tight, orderly base near highs in a clear uptrend, without obvious supply just overhead. Prefer the quality of the base over a story.",
      must_pass: "The base is orderly. The trend is intact. Nothing in the headlines breaks that picture.",
      disqualify: "The base is messy or wide. Overhead supply is obvious. A headline contradicts the setup.",
      do_not: "Do not change the entry, stop, or share count. Do not invent a catalyst or a price. If the evidence is missing, say so.",
    },
  };
}

/** The swing routine as a saved strategy: same rules as the template, with a name. */
export function builtinStrategy(): Strategy {
  const doc = swingTemplate();
  doc.profile.name = "Swing routine";
  return doc;
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function flag(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "on" || v === 1) return true;
  if (v === "false" || v === "off" || v === 0) return false;
  return fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function pickList<T extends string>(v: unknown, allowed: readonly T[], fallback: T[], allowEmpty = false): T[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : null;
  if (!raw) return fallback;
  const set = new Set<string>(allowed);
  const out = raw.map((x) => String(x).trim()).filter((x): x is T => set.has(x));
  if (!out.length && !allowEmpty) return fallback;
  return [...new Set(out)];
}

function words(v: unknown, fallback: string[]): string[] {
  if (v == null) return fallback;
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : fallback;
  const out = raw.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  return [...new Set(out)].slice(0, 24);
}

function clock(v: unknown, fallback: string): string {
  const s = String(v ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : fallback;
}

function text(v: unknown, fallback: string, max: number): string {
  if (typeof v !== "string") return fallback;
  return v.trim().slice(0, max);
}

function section<T extends Record<string, unknown>>(v: unknown): T {
  return v && typeof v === "object" ? (v as T) : ({} as T);
}

export function normalizeStrategy(input: unknown): { ok: true; strategy: Strategy } | { ok: false; error: string } {
  const base = swingTemplate();
  const src = section<Partial<Record<StrategySectionId, unknown>>>(input);
  const profile = section<Strategy["profile"]>(src.profile);
  const universe = section<Strategy["universe"]>(src.universe);
  const scanner = section<Strategy["scanner"]>(src.scanner);
  const technical = section<Strategy["technical"]>(src.technical);
  const risk = section<Strategy["risk"]>(src.risk);
  const regime = section<Strategy["regime"]>(src.regime);
  const news = section<Strategy["news"]>(src.news);
  const alerts = section<Strategy["alerts"]>(src.alerts);
  const management = section<Strategy["management"]>(src.management);
  const evaluator = section<Strategy["evaluator"]>(src.evaluator);
  const gates = section<Strategy["evaluator"]["gates"]>(evaluator.gates);

  const name = String(profile.name ?? "").trim().slice(0, 80);
  if (!name) return { ok: false, error: "Name the strategy before saving." };

  const thesis = String(profile.thesis ?? base.profile.thesis).trim().slice(0, 400);
  const targetMin = num(scanner.target_min, base.scanner.target_min, 1, 500);
  const targetMax = num(scanner.target_max, base.scanner.target_max, targetMin, 2000);
  const bufferMin = num(risk.entry_buffer_min_pct, base.risk.entry_buffer_min_pct, 0, 5);
  const bufferMax = num(risk.entry_buffer_max_pct, base.risk.entry_buffer_max_pct, bufferMin, 5);
  const stopNormal = num(risk.stop_max_pct, base.risk.stop_max_pct, 1, 30);
  const stopLoose = num(risk.stop_max_pct_loose, base.risk.stop_max_pct_loose, stopNormal, 40);

  const strategy: Strategy = {
    profile: {
      name,
      thesis: thesis || base.profile.thesis,
      style: oneOf(profile.style, STRATEGY_STYLES, base.profile.style),
      horizon_days: num(profile.horizon_days, base.profile.horizon_days, 1, 250),
      status: oneOf(profile.status, STRATEGY_STATUSES, "draft"),
    },
    universe: {
      exchanges: pickList(universe.exchanges, EXCHANGES, base.universe.exchanges),
      market_cap_min: num(universe.market_cap_min, base.universe.market_cap_min, 0, 1e13),
      exclude_etfs: flag(universe.exclude_etfs, base.universe.exclude_etfs),
      max_tickers: num(universe.max_tickers, base.universe.max_tickers, 50, 8000),
    },
    scanner: {
      enabled: flag(scanner.enabled, true),
      price_min: num(scanner.price_min, base.scanner.price_min, 0, 10000),
      avg_volume_min: num(scanner.avg_volume_min, base.scanner.avg_volume_min, 0, 1e9),
      pct_below_52w_high_max: num(scanner.pct_below_52w_high_max, base.scanner.pct_below_52w_high_max, 0, 80),
      weekly_volatility_max: num(scanner.weekly_volatility_max, base.scanner.weekly_volatility_max, 0.1, 30),
      above_sma50: flag(scanner.above_sma50, true),
      above_sma200: flag(scanner.above_sma200, true),
      sma50_above_sma200: flag(scanner.sma50_above_sma200, true),
      earnings_blackout_days: num(scanner.earnings_blackout_days, base.scanner.earnings_blackout_days, 0, 30),
      target_min: targetMin,
      target_max: targetMax,
      ladder_high_pct: num(scanner.ladder_high_pct, base.scanner.ladder_high_pct, 0, 80),
      ladder_volatility_max: num(scanner.ladder_volatility_max, base.scanner.ladder_volatility_max, 0.1, 30),
      ladder_volume_min: num(scanner.ladder_volume_min, base.scanner.ladder_volume_min, 0, 1e9),
      ladder_market_cap_min: num(scanner.ladder_market_cap_min, base.scanner.ladder_market_cap_min, 0, 1e13),
    },
    technical: {
      enabled: flag(technical.enabled, true),
      min_trend_score: num(technical.min_trend_score, base.technical.min_trend_score, 1, 8),
      near_high_pct: num(technical.near_high_pct, base.technical.near_high_pct, 1, 40),
      patterns: pickList(
        technical.patterns,
        PATTERN_OPTIONS.map(([k]) => k),
        base.technical.patterns,
        true,
      ),
      rs_rating_min: num(technical.rs_rating_min, base.technical.rs_rating_min, 1, 99),
      rs_hard_filter: flag(technical.rs_hard_filter, false),
      trend_template_hard_filter: flag(technical.trend_template_hard_filter, false),
      vcp_max_ratio: num(technical.vcp_max_ratio, base.technical.vcp_max_ratio, 0.2, 1),
      overhead_lookback_months: num(technical.overhead_lookback_months, base.technical.overhead_lookback_months, 3, 60),
      overhead_zone_pct: num(technical.overhead_zone_pct, base.technical.overhead_zone_pct, 1, 40),
    },
    risk: {
      account_size_usd: num(risk.account_size_usd, base.risk.account_size_usd, 100, 1e9),
      risk_pct: num(risk.risk_pct, base.risk.risk_pct, 0.1, 5),
      heat_cap_pct: num(risk.heat_cap_pct, base.risk.heat_cap_pct, 0.5, 20),
      max_positions: num(risk.max_positions, base.risk.max_positions, 1, 30),
      max_per_sector: num(risk.max_per_sector, base.risk.max_per_sector, 1, 10),
      max_notional_pct: num(risk.max_notional_pct, base.risk.max_notional_pct, 5, 100),
      stop_max_pct: stopNormal,
      stop_max_pct_loose: stopLoose,
      min_r: num(risk.min_r, base.risk.min_r, 1, 10),
      entry_buffer_min_pct: bufferMin,
      entry_buffer_max_pct: bufferMax,
    },
    regime: {
      enabled: flag(regime.enabled, true),
      distribution_pressure: num(regime.distribution_pressure, base.regime.distribution_pressure, 1, 20),
      distribution_correction: num(regime.distribution_correction, base.regime.distribution_correction, 1, 25),
      breadth_risk_on_pct: num(regime.breadth_risk_on_pct, base.regime.breadth_risk_on_pct, 20, 90),
      breadth_risk_off_pct: num(regime.breadth_risk_off_pct, base.regime.breadth_risk_off_pct, 5, 80),
      futures_red_pct: num(regime.futures_red_pct, base.regime.futures_red_pct, -5, 0),
      respect_macro_blackout: flag(regime.respect_macro_blackout, true),
    },
    news: {
      enabled: flag(news.enabled, true),
      lookback_days: num(news.lookback_days, base.news.lookback_days, 1, 30),
      max_headlines: num(news.max_headlines, base.news.max_headlines, 1, 30),
      earnings_warn_days: num(news.earnings_warn_days, base.news.earnings_warn_days, 0, 15),
      red_flags: words(news.red_flags, base.news.red_flags),
    },
    alerts: {
      enabled: flag(alerts.enabled, true),
      session_start: clock(alerts.session_start, base.alerts.session_start),
      session_end: clock(alerts.session_end, base.alerts.session_end),
      rvol_min: num(alerts.rvol_min, base.alerts.rvol_min, 0.5, 10),
      no_chase_pct: num(alerts.no_chase_pct, base.alerts.no_chase_pct, 0, 10),
      require_above_vwap: flag(alerts.require_above_vwap, true),
      require_above_prior_close: flag(alerts.require_above_prior_close, true),
    },
    management: {
      sell_half_at_r: num(management.sell_half_at_r, base.management.sell_half_at_r, 0.5, 10),
      trail_ema: num(management.trail_ema, base.management.trail_ema, 3, 50),
      earnings_decision_days: num(management.earnings_decision_days, base.management.earnings_decision_days, 0, 15),
      exit_failed_breakout: flag(management.exit_failed_breakout, true),
    },
    evaluator: {
      gates: {
        plan_card: flag(gates.plan_card, base.evaluator.gates.plan_card),
        actionable_alert: flag(gates.actionable_alert, base.evaluator.gates.actionable_alert),
        management: flag(gates.management, base.evaluator.gates.management),
      },
      direction: text(evaluator.direction, base.evaluator.direction, 1200),
      must_pass: text(evaluator.must_pass, base.evaluator.must_pass, 800),
      disqualify: text(evaluator.disqualify, base.evaluator.disqualify, 800),
      do_not: text(evaluator.do_not, base.evaluator.do_not, 800),
    },
  };

  return { ok: true, strategy };
}

export function gatesOn(s: Strategy): string[] {
  const on: string[] = [];
  if (s.scanner.enabled) on.push("Scanner");
  if (s.technical.enabled) on.push("Technical");
  if (s.regime.enabled) on.push("Regime");
  if (s.news.enabled) on.push("News");
  if (s.alerts.enabled) on.push("Alerts");
  if (s.evaluator.gates.plan_card || s.evaluator.gates.actionable_alert || s.evaluator.gates.management) on.push("Evaluator");
  return on;
}
