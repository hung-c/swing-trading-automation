export type Sizing = "full" | "half" | "none";

export type PlanStatus = "watch" | "rejected" | "triggered" | "open" | "closed";

export type EarningsInfo = {
  date?: string | null;
  trading_days_away?: number | null;
};

export type PlanCard = {
  symbol: string;
  pattern: string;
  resistance: number;
  entry: number;
  stop: number;
  risk_per_share: number;
  stop_pct: number;
  shares: number;
  fractional_shares?: number;
  notional: number;
  target_2r: number;
  target_3r: number;
  atr14: number;
  stop_atr_mult: number;
  earnings?: EarningsInfo | null;
  sector?: string | null;
  rs_rating?: number | null;
  trend_score: number;
  trend_missing?: string[];
  pattern_quality: number;
  alert_level: number;
  status: PlanStatus;
  rejected_reason?: string | null;
  notes?: string[];
  chart_paths?: Record<string, string>;
  evaluations?: TickerEvaluation[];
};

export type TickerEvaluation = {
  verdict: "take" | "watch" | "skip";
  reasons: string[];
  open_questions: string[];
  model: string;
  prompt_version: string;
  gate: "plan_card" | "actionable_alert" | "management";
};

export type DistributionState = {
  symbol: string;
  distribution_days: number;
  status: string;
  follow_through?: boolean;
};

export type MacroEvent = {
  name: string;
  date: string;
  time_et: string;
};

export type RegimeReport = {
  as_of: string;
  spy_close?: number | null;
  spy_above_50?: boolean | null;
  spy_above_200?: boolean | null;
  spy_ma50_rising?: boolean | null;
  qqq_close?: number | null;
  qqq_above_50?: boolean | null;
  qqq_above_200?: boolean | null;
  qqq_ma50_rising?: boolean | null;
  es_pct?: number | null;
  nq_pct?: number | null;
  futures_red?: boolean | null;
  distribution?: DistributionState[];
  breadth_pct_above_50?: number | null;
  breadth_pct_above_200?: number | null;
  new_highs?: number | null;
  new_lows?: number | null;
  faber_risk_on?: boolean | null;
  sizing: Sizing;
  max_new_positions?: number | null;
  macro_today?: MacroEvent[];
  macro_week?: MacroEvent[];
  no_new_entries_before?: string | null;
  no_new_entries_after?: string | null;
  notes?: string[];
};

export type NewsItem = {
  symbol: string;
  headline: string;
  source?: string;
  url?: string;
  published?: string | null;
  summary?: string;
};

export type TickerNews = {
  symbol: string;
  items?: NewsItem[];
  avg_sentiment?: number | null;
  red_flags?: string[];
};

export type AlertRow = {
  day: string;
  ts: string;
  symbol: string;
  condition: string;
  price: number | null;
  rvol: number | null;
  vwap: number | null;
  actionable: boolean;
  message: string;
};

export type PositionRow = {
  symbol: string;
  opened: string;
  entry: number;
  stop: number;
  initial_stop: number;
  shares: number;
  target_2r: number;
  pattern: string | null;
  sector: string | null;
  half_sold: boolean;
  closed: string | null;
  exit_price: number | null;
  r_multiple: number | null;
  resistance: number | null;
};

export type TradeRow = {
  id: number;
  symbol: string;
  opened: string | null;
  closed: string | null;
  entry: number | null;
  exit_price: number | null;
  shares: number | null;
  r_multiple: number | null;
  pattern: string | null;
  sector: string | null;
};

export type BriefProse = {
  headline: string;
  market_summary: string;
  watchlist_commentary: string;
  risk_notes: string;
  tomorrow_checklist: string[];
};

export type DailyBrief = {
  date: string;
  kind: string;
  regime?: RegimeReport | null;
  screen_count_strict?: number;
  screen_count_final?: number;
  ladder_step_used?: number;
  weekly_survivors?: number;
  plans?: PlanCard[];
  rejected?: PlanCard[];
  news?: TickerNews[];
  alerts?: unknown[];
  manage?: { symbol: string; action: string; reason: string; new_stop?: number | null }[];
  positions?: PositionRow[];
  heat_pct?: number | null;
  prose?: BriefProse | null;
  llm_provider?: string;
  warnings?: string[];
};

export type Snapshot = {
  configured: boolean;
  brief: DailyBrief | null;
  premarket: DailyBrief | null;
  alerts: AlertRow[];
  positions: PositionRow[];
  trades: TradeRow[];
  prices: Record<string, number>;
  pricesAt: string | null;
  planDate: string | null;
};
