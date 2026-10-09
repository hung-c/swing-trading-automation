import { Area, Check, Num, Pick, Txt } from "@/components/fields";
import {
  CLOCK_COPY,
  CLOCK_DEFAULTS,
  EARLY_CLOSE_NIGHTLY,
  TICK_TIMES,
  ceilToTick,
  clockOf,
  floorToTick,
  type BlockId,
  type ClockSchedule,
  type FlowClock,
} from "@/lib/strategy-flow";
import {
  EXCHANGES,
  PATTERN_OPTIONS,
  STRATEGY_SECTIONS,
  STRATEGY_STATUSES,
  STRATEGY_STYLES,
  type Exchange,
  type PatternKey,
  type Strategy,
  type StrategySectionId,
} from "@/lib/strategy";
import type { StrategyReview } from "@/lib/strategy-review";

export function BlockSetup({
  block,
  doc,
  flagsText,
  review,
  onFlags,
  onClock,
  patch,
  toggleExchange,
  togglePattern,
}: {
  block: BlockId;
  doc: Strategy;
  flagsText: string;
  review: StrategyReview | null;
  onFlags: (s: string) => void;
  onClock: (clock: FlowClock, patch: Partial<ClockSchedule>) => void;
  patch: <S extends StrategySectionId>(section: S, partial: Partial<Strategy[S]>) => void;
  toggleExchange: (ex: Exchange) => void;
  togglePattern: (key: PatternKey) => void;
}) {
  const clock = clockOf(block);
  const sectionTitle = STRATEGY_SECTIONS.find((s) => s.id === block)?.summary;
  const findings = review?.findings.filter((f) => f.section.toLowerCase() === BLOCK_META_SECTION[block]) ?? [];

  return (
    <>
      {sectionTitle ? <p className="notes">{sectionTitle}</p> : null}
      {clock ? (
        <>
          <p className="notes">{CLOCK_COPY[clock]}</p>
          <Check
            label="This strategy joins this job"
            checked={doc.flow.clocks[clock].enabled}
            onChange={(v) => onClock(clock, { enabled: v })}
          />
          <Pick
            label="Start"
            hint="ET. Swing Tick runs at these times, every 15 minutes from 07:03 to 19:03."
            value={ceilToTick(doc.flow.clocks[clock].start)}
            options={TICK_TIMES}
            onChange={(s) => onClock(clock, { start: s })}
          />
          {clock === "intraday" ? (
            <Pick
              label="End"
              hint="ET. Alerts run on each tick from the start through this time."
              value={floorToTick(doc.flow.clocks[clock].end ?? CLOCK_DEFAULTS.intraday.end ?? "15:48")}
              options={TICK_TIMES}
              onChange={(s) => onClock(clock, { end: s })}
            />
          ) : null}
          {clock === "nightly" && ceilToTick(doc.flow.clocks[clock].start) === CLOCK_DEFAULTS.nightly.start ? (
            <p className="notes">On an early-close day this runs at {EARLY_CLOSE_NIGHTLY} ET. Any other start time is used as written.</p>
          ) : null}
          {clock === "report" ? <p className="notes">Friday only.</p> : null}
          <p className="notes">The desk still wakes once for everyone. This switch records whether this strategy takes part.</p>
        </>
      ) : null}
      {block === "profile" ? <ProfileFields doc={doc} patch={patch} /> : null}
      {block === "universe" ? <UniverseFields doc={doc} patch={patch} toggleExchange={toggleExchange} /> : null}
      {block === "scanner" ? <ScannerFields doc={doc} patch={patch} /> : null}
      {block === "technical" ? <TechnicalFields doc={doc} patch={patch} togglePattern={togglePattern} /> : null}
      {block === "risk" ? <RiskFields doc={doc} patch={patch} /> : null}
      {block === "regime" ? <RegimeFields doc={doc} patch={patch} /> : null}
      {block === "news" ? <NewsFields doc={doc} flagsText={flagsText} onFlags={onFlags} patch={patch} /> : null}
      {block === "alerts" ? <AlertsFields doc={doc} patch={patch} /> : null}
      {block === "management" ? <ManagementFields doc={doc} patch={patch} /> : null}
      {block === "evaluator" ? <EvaluatorFields doc={doc} patch={patch} /> : null}
      {findings.length ? (
        <ul className="review-list">
          {findings.map((f, i) => (
            <li key={`${f.section}-${i}`}>
              <span className={`chip ${f.severity === "conflict" ? "bad" : f.severity === "gap" ? "warn" : ""}`}>{f.severity}</span>
              <span>{f.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

const BLOCK_META_SECTION: Record<BlockId, string> = {
  profile: "profile",
  "clock:nightly": "",
  "clock:premarket": "",
  "clock:intraday": "",
  "clock:report": "",
  universe: "universe",
  scanner: "scanner",
  technical: "technical",
  risk: "risk",
  regime: "regime",
  news: "news",
  alerts: "alerts",
  management: "management",
  evaluator: "evaluator",
};

function ProfileFields({
  doc,
  patch,
}: {
  doc: Strategy;
  patch: <S extends StrategySectionId>(section: S, partial: Partial<Strategy[S]>) => void;
}) {
  return (
    <div className="fields">
      <label className="span-2">
        Name
        <input required value={doc.profile.name} placeholder="Tight base breakout" onChange={(e) => patch("profile", { name: e.target.value })} />
      </label>
      <label>
        Status
        <select value={doc.profile.status} onChange={(e) => patch("profile", { status: e.target.value as Strategy["profile"]["status"] })}>
          {STRATEGY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="span-3">
        Thesis
        <input value={doc.profile.thesis} onChange={(e) => patch("profile", { thesis: e.target.value })} />
        <span className="hint">One sentence: what you buy, and why.</span>
      </label>
      <label>
        Style
        <select value={doc.profile.style} onChange={(e) => patch("profile", { style: e.target.value as Strategy["profile"]["style"] })}>
          {STRATEGY_STYLES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <Num
        label="Hold, days"
        hint="Typical winner, not a hard time stop."
        value={doc.profile.horizon_days}
        min={1}
        max={250}
        onChange={(n) => patch("profile", { horizon_days: n })}
      />
    </div>
  );
}

function UniverseFields({
  doc,
  patch,
  toggleExchange,
}: {
  doc: Strategy;
  patch: <S extends StrategySectionId>(section: S, partial: Partial<Strategy[S]>) => void;
  toggleExchange: (ex: Exchange) => void;
}) {
  return (
    <div className="fields">
      <div className="span-3">
        <div className="kicker">Exchanges</div>
        <div className="checks">
          {EXCHANGES.map((ex) => (
            <Check key={ex} label={ex} checked={doc.universe.exchanges.includes(ex)} onChange={() => toggleExchange(ex)} />
          ))}
          <Check label="Exclude ETFs" checked={doc.universe.exclude_etfs} onChange={(v) => patch("universe", { exclude_etfs: v })} />
        </div>
      </div>
      <Num
        label="Min market cap"
        hint="Dollars. 2000000000 is $2B."
        value={doc.universe.market_cap_min}
        min={0}
        onChange={(n) => patch("universe", { market_cap_min: n })}
      />
      <Num label="Max names for bars" value={doc.universe.max_tickers} min={50} max={8000} onChange={(n) => patch("universe", { max_tickers: n })} />
    </div>
  );
}

function ScannerFields({
  doc,
  patch,
}: {
  doc: Strategy;
  patch: <S extends StrategySectionId>(section: S, partial: Partial<Strategy[S]>) => void;
}) {
  return (
    <div className="fields">
      <div className="span-3">
        <Check label="Run the scanner" checked={doc.scanner.enabled} onChange={(v) => patch("scanner", { enabled: v })} />
      </div>
      <Num label="Min price" value={doc.scanner.price_min} min={0} onChange={(n) => patch("scanner", { price_min: n })} />
      <Num label="Min avg volume" hint="63-session average shares." value={doc.scanner.avg_volume_min} min={0} onChange={(n) => patch("scanner", { avg_volume_min: n })} />
      <Num label="Max % below 52w high" value={doc.scanner.pct_below_52w_high_max} min={0} max={80} onChange={(n) => patch("scanner", { pct_below_52w_high_max: n })} />
      <Num label="Max weekly volatility %" value={doc.scanner.weekly_volatility_max} min={0.1} max={30} onChange={(n) => patch("scanner", { weekly_volatility_max: n })} />
      <Num
        label="Earnings blackout, days"
        hint="Skip names reporting inside this many sessions."
        value={doc.scanner.earnings_blackout_days}
        min={0}
        max={30}
        onChange={(n) => patch("scanner", { earnings_blackout_days: n })}
      />
      <Num label="Target min names" value={doc.scanner.target_min} min={1} onChange={(n) => patch("scanner", { target_min: n })} />
      <Num label="Target max names" value={doc.scanner.target_max} min={1} onChange={(n) => patch("scanner", { target_max: n })} />
      <div className="span-3 checks">
        <Check label="Price above SMA50" checked={doc.scanner.above_sma50} onChange={(v) => patch("scanner", { above_sma50: v })} />
        <Check label="Price above SMA200" checked={doc.scanner.above_sma200} onChange={(v) => patch("scanner", { above_sma200: v })} />
        <Check label="SMA50 above SMA200" checked={doc.scanner.sma50_above_sma200} onChange={(v) => patch("scanner", { sma50_above_sma200: v })} />
      </div>
      <div className="span-3">
        <div className="kicker">Relaxation ladder</div>
        <p className="notes">If the strict scan is shorter than the target, loosen these one step at a time.</p>
      </div>
      <Num label="Ladder: % below high" value={doc.scanner.ladder_high_pct} onChange={(n) => patch("scanner", { ladder_high_pct: n })} />
      <Num label="Ladder: weekly vol %" value={doc.scanner.ladder_volatility_max} onChange={(n) => patch("scanner", { ladder_volatility_max: n })} />
      <Num label="Ladder: min volume" value={doc.scanner.ladder_volume_min} onChange={(n) => patch("scanner", { ladder_volume_min: n })} />
      <Num label="Ladder: min market cap" value={doc.scanner.ladder_market_cap_min} onChange={(n) => patch("scanner", { ladder_market_cap_min: n })} />
    </div>
  );
}

function TechnicalFields({
  doc,
  patch,
  togglePattern,
}: {
  doc: Strategy;
  patch: <S extends StrategySectionId>(section: S, partial: Partial<Strategy[S]>) => void;
  togglePattern: (key: PatternKey) => void;
}) {
  return (
    <div className="fields">
      <div className="span-3">
        <Check label="Score technicals" checked={doc.technical.enabled} onChange={(v) => patch("technical", { enabled: v })} />
      </div>
      <Num label="Min trend score" hint="Out of 8. Below this, the name is dropped." value={doc.technical.min_trend_score} min={1} max={8} onChange={(n) => patch("technical", { min_trend_score: n })} />
      <Num label="Near-high %" value={doc.technical.near_high_pct} min={1} max={40} onChange={(n) => patch("technical", { near_high_pct: n })} />
      <Num label="Min RS rating" value={doc.technical.rs_rating_min} min={1} max={99} onChange={(n) => patch("technical", { rs_rating_min: n })} />
      <div className="span-3">
        <div className="kicker">Patterns</div>
        <div className="checks">
          {PATTERN_OPTIONS.map(([key, label]) => (
            <Check key={key} label={label} checked={doc.technical.patterns.includes(key)} onChange={() => togglePattern(key)} />
          ))}
        </div>
      </div>
      <div className="span-3 checks">
        <Check label="RS rating is a hard filter" checked={doc.technical.rs_hard_filter} onChange={(v) => patch("technical", { rs_hard_filter: v })} />
        <Check
          label="Trend template is a hard filter"
          checked={doc.technical.trend_template_hard_filter}
          onChange={(v) => patch("technical", { trend_template_hard_filter: v })}
        />
      </div>
      <Num
        label="VCP contraction ratio"
        hint="Each pullback must be at most this fraction of the prior one."
        value={doc.technical.vcp_max_ratio}
        min={0.2}
        max={1}
        onChange={(n) => patch("technical", { vcp_max_ratio: n })}
      />
      <Num label="Overhead lookback, months" value={doc.technical.overhead_lookback_months} min={3} max={60} onChange={(n) => patch("technical", { overhead_lookback_months: n })} />
      <Num label="Supply zone, % above price" value={doc.technical.overhead_zone_pct} min={1} max={40} onChange={(n) => patch("technical", { overhead_zone_pct: n })} />
    </div>
  );
}

function RiskFields({
  doc,
  patch,
}: {
  doc: Strategy;
  patch: <S extends StrategySectionId>(section: S, partial: Partial<Strategy[S]>) => void;
}) {
  return (
    <div className="fields">
      <Num label="Account size, USD" value={doc.risk.account_size_usd} min={100} onChange={(n) => patch("risk", { account_size_usd: n })} />
      <Num label="Risk % per trade" value={doc.risk.risk_pct} min={0.1} max={5} onChange={(n) => patch("risk", { risk_pct: n })} />
      <Num label="Heat cap %" value={doc.risk.heat_cap_pct} min={0.5} max={20} onChange={(n) => patch("risk", { heat_cap_pct: n })} />
      <Num label="Max positions" value={doc.risk.max_positions} min={1} max={30} onChange={(n) => patch("risk", { max_positions: n })} />
      <Num label="Max per sector" value={doc.risk.max_per_sector} min={1} max={10} onChange={(n) => patch("risk", { max_per_sector: n })} />
      <Num label="Max notional %" value={doc.risk.max_notional_pct} min={5} max={100} onChange={(n) => patch("risk", { max_notional_pct: n })} />
      <Num label="Stop max % (normal)" value={doc.risk.stop_max_pct} min={1} max={30} onChange={(n) => patch("risk", { stop_max_pct: n })} />
      <Num
        label="Stop max % (loose)"
        hint="Used only when the structural stop is wider than the normal cap."
        value={doc.risk.stop_max_pct_loose}
        min={1}
        max={40}
        onChange={(n) => patch("risk", { stop_max_pct_loose: n })}
      />
      <Num label="Minimum R" value={doc.risk.min_r} min={1} max={10} onChange={(n) => patch("risk", { min_r: n })} />
      <Num label="Entry buffer min %" value={doc.risk.entry_buffer_min_pct} min={0} max={5} onChange={(n) => patch("risk", { entry_buffer_min_pct: n })} />
      <Num label="Entry buffer max %" value={doc.risk.entry_buffer_max_pct} min={0} max={5} onChange={(n) => patch("risk", { entry_buffer_max_pct: n })} />
    </div>
  );
}

function RegimeFields({
  doc,
  patch,
}: {
  doc: Strategy;
  patch: <S extends StrategySectionId>(section: S, partial: Partial<Strategy[S]>) => void;
}) {
  return (
    <div className="fields">
      <div className="span-3">
        <Check label="Gate new entries on regime" checked={doc.regime.enabled} onChange={(v) => patch("regime", { enabled: v })} />
      </div>
      <Num label="Distribution days: half size" value={doc.regime.distribution_pressure} min={1} max={20} onChange={(n) => patch("regime", { distribution_pressure: n })} />
      <Num label="Distribution days: no entries" value={doc.regime.distribution_correction} min={1} max={25} onChange={(n) => patch("regime", { distribution_correction: n })} />
      <Num label="Breadth risk-on %" value={doc.regime.breadth_risk_on_pct} onChange={(n) => patch("regime", { breadth_risk_on_pct: n })} />
      <Num label="Breadth risk-off %" value={doc.regime.breadth_risk_off_pct} onChange={(n) => patch("regime", { breadth_risk_off_pct: n })} />
      <Num
        label="Futures red threshold %"
        hint="ES/NQ below this at the open blocks the morning."
        value={doc.regime.futures_red_pct}
        onChange={(n) => patch("regime", { futures_red_pct: n })}
      />
      <div className="span-3">
        <Check
          label="Respect macro blackout (CPI, NFP, FOMC)"
          checked={doc.regime.respect_macro_blackout}
          onChange={(v) => patch("regime", { respect_macro_blackout: v })}
        />
      </div>
    </div>
  );
}

function NewsFields({
  doc,
  flagsText,
  onFlags,
  patch,
}: {
  doc: Strategy;
  flagsText: string;
  onFlags: (s: string) => void;
  patch: <S extends StrategySectionId>(section: S, partial: Partial<Strategy[S]>) => void;
}) {
  return (
    <div className="fields">
      <div className="span-3">
        <Check label="Read news before a plan is kept" checked={doc.news.enabled} onChange={(v) => patch("news", { enabled: v })} />
      </div>
      <Num label="Lookback, days" value={doc.news.lookback_days} min={1} max={30} onChange={(n) => patch("news", { lookback_days: n })} />
      <Num label="Headlines per name" value={doc.news.max_headlines} min={1} max={30} onChange={(n) => patch("news", { max_headlines: n })} />
      <Num
        label="Warn if earnings within, days"
        hint="Open positions, not the scanner blackout."
        value={doc.news.earnings_warn_days}
        min={0}
        max={15}
        onChange={(n) => patch("news", { earnings_warn_days: n })}
      />
      <label className="span-3">
        Red-flag phrases
        <input value={flagsText} onChange={(e) => onFlags(e.target.value)} />
        <span className="hint">Comma-separated. A headline containing one of these marks the name.</span>
      </label>
    </div>
  );
}

function AlertsFields({
  doc,
  patch,
}: {
  doc: Strategy;
  patch: <S extends StrategySectionId>(section: S, partial: Partial<Strategy[S]>) => void;
}) {
  return (
    <div className="fields">
      <div className="span-3">
        <Check label="Raise intraday alerts" checked={doc.alerts.enabled} onChange={(v) => patch("alerts", { enabled: v })} />
      </div>
      <Txt label="Session start" hint="ET, 24-hour." value={doc.alerts.session_start} onChange={(s) => patch("alerts", { session_start: s })} />
      <Txt label="Session end" value={doc.alerts.session_end} onChange={(s) => patch("alerts", { session_end: s })} />
      <Num label="Min RVOL" value={doc.alerts.rvol_min} min={0.5} max={10} onChange={(n) => patch("alerts", { rvol_min: n })} />
      <Num label="No-chase, % through entry" value={doc.alerts.no_chase_pct} min={0} max={10} onChange={(n) => patch("alerts", { no_chase_pct: n })} />
      <div className="span-3 checks">
        <Check label="Require price above VWAP" checked={doc.alerts.require_above_vwap} onChange={(v) => patch("alerts", { require_above_vwap: v })} />
        <Check
          label="Require price above prior close"
          checked={doc.alerts.require_above_prior_close}
          onChange={(v) => patch("alerts", { require_above_prior_close: v })}
        />
      </div>
    </div>
  );
}

function ManagementFields({
  doc,
  patch,
}: {
  doc: Strategy;
  patch: <S extends StrategySectionId>(section: S, partial: Partial<Strategy[S]>) => void;
}) {
  return (
    <div className="fields">
      <Num label="Sell half at R" value={doc.management.sell_half_at_r} min={0.5} max={10} onChange={(n) => patch("management", { sell_half_at_r: n })} />
      <Num label="Trail under EMA" value={doc.management.trail_ema} min={3} max={50} onChange={(n) => patch("management", { trail_ema: n })} />
      <Num label="Earnings decision, days" value={doc.management.earnings_decision_days} min={0} max={15} onChange={(n) => patch("management", { earnings_decision_days: n })} />
      <div className="span-3">
        <Check
          label="Exit a failed breakout (close back under resistance)"
          checked={doc.management.exit_failed_breakout}
          onChange={(v) => patch("management", { exit_failed_breakout: v })}
        />
      </div>
    </div>
  );
}

function EvaluatorFields({
  doc,
  patch,
}: {
  doc: Strategy;
  patch: <S extends StrategySectionId>(section: S, partial: Partial<Strategy[S]>) => void;
}) {
  return (
    <div className="fields">
      <div className="span-3">
        <div className="kicker">When</div>
        <p className="notes">
          The agent runs only after a name has already cleared the hard rules. Plan card is the nightly judgment. An actionable alert is the last
          look before you copy the bracket. Management is the hold-or-out check.
        </p>
        <div className="checks">
          <Check
            label="Plan card"
            checked={doc.evaluator.gates.plan_card}
            onChange={(v) => patch("evaluator", { gates: { ...doc.evaluator.gates, plan_card: v } })}
          />
          <Check
            label="Actionable alert"
            checked={doc.evaluator.gates.actionable_alert}
            onChange={(v) => patch("evaluator", { gates: { ...doc.evaluator.gates, actionable_alert: v } })}
          />
          <Check
            label="Management event"
            checked={doc.evaluator.gates.management}
            onChange={(v) => patch("evaluator", { gates: { ...doc.evaluator.gates, management: v } })}
          />
        </div>
      </div>
      <Area label="Direction" hint="What a good name looks like for this strategy." value={doc.evaluator.direction} onChange={(s) => patch("evaluator", { direction: s })} />
      <Area label="Must pass" hint="Qualitative rules the chart math cannot express." value={doc.evaluator.must_pass} onChange={(s) => patch("evaluator", { must_pass: s })} />
      <Area label="Disqualify" hint="What makes you pass even when the numbers cleared." value={doc.evaluator.disqualify} onChange={(s) => patch("evaluator", { disqualify: s })} />
      <Area label="Do not" hint="Limits. The agent must not override the stop or invent a catalyst." value={doc.evaluator.do_not} onChange={(s) => patch("evaluator", { do_not: s })} />
    </div>
  );
}
