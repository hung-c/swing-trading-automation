"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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

function Num({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step="any"
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      />
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

function Txt({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkline">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function StrategyForm({ initial, id }: { initial: Strategy; id?: string }) {
  const router = useRouter();
  const [doc, setDoc] = useState<Strategy>(initial);
  const [flagsText, setFlagsText] = useState(initial.news.red_flags.join(", "));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function patch<S extends StrategySectionId>(section: S, partial: Partial<Strategy[S]>) {
    setDoc((prev) => ({ ...prev, [section]: { ...prev[section], ...partial } }));
  }

  function toggleExchange(ex: Exchange) {
    const cur = doc.universe.exchanges;
    const next = cur.includes(ex) ? cur.filter((x) => x !== ex) : [...cur, ex];
    patch("universe", { exchanges: next.length ? next : cur });
  }

  function togglePattern(key: PatternKey) {
    const cur = doc.technical.patterns;
    const next = cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key];
    patch("technical", { patterns: next });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const payload: Strategy = {
      ...doc,
      news: {
        ...doc.news,
        red_flags: flagsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    };
    const res = await fetch(id ? `/api/strategies/${id}` : "/api/strategies", {
      method: id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error ?? res.statusText);
      return;
    }
    router.push("/strategies");
    router.refresh();
  }

  async function onDelete() {
    if (!id) return;
    if (!window.confirm(`Delete “${doc.profile.name || "this strategy"}”?`)) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/strategies/${id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error ?? res.statusText);
      return;
    }
    router.push("/strategies");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="strategy-grid">
        <nav className="side-nav" aria-label="Strategy sections">
          {STRATEGY_SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.title}
            </a>
          ))}
        </nav>

        <div className="strategy-main">
          <section className="card sec" id="profile">
            <h2>Profile</h2>
            <p className="notes">{STRATEGY_SECTIONS[0].summary}</p>
            <div className="fields">
              <label className="span-2">
                Name
                <input
                  required
                  value={doc.profile.name}
                  placeholder="Tight base breakout"
                  onChange={(e) => patch("profile", { name: e.target.value })}
                />
              </label>
              <label>
                Status
                <select
                  value={doc.profile.status}
                  onChange={(e) => patch("profile", { status: e.target.value as Strategy["profile"]["status"] })}
                >
                  {STRATEGY_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="span-3">
                Thesis
                <input
                  value={doc.profile.thesis}
                  onChange={(e) => patch("profile", { thesis: e.target.value })}
                />
                <span className="hint">One sentence: what you buy, and why.</span>
              </label>
              <label>
                Style
                <select
                  value={doc.profile.style}
                  onChange={(e) => patch("profile", { style: e.target.value as Strategy["profile"]["style"] })}
                >
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
                step={1}
                onChange={(n) => patch("profile", { horizon_days: n })}
              />
            </div>
          </section>

          <section className="card sec" id="universe">
            <h2>Universe</h2>
            <p className="notes">{STRATEGY_SECTIONS[1].summary}</p>
            <div className="fields">
              <div className="span-3">
                <div className="kicker">Exchanges</div>
                <div className="checks">
                  {EXCHANGES.map((ex) => (
                    <Check
                      key={ex}
                      label={ex}
                      checked={doc.universe.exchanges.includes(ex)}
                      onChange={() => toggleExchange(ex)}
                    />
                  ))}
                  <Check
                    label="Exclude ETFs"
                    checked={doc.universe.exclude_etfs}
                    onChange={(v) => patch("universe", { exclude_etfs: v })}
                  />
                </div>
              </div>
              <Num
                label="Min market cap"
                hint="Dollars. 2000000000 is $2B."
                value={doc.universe.market_cap_min}
                min={0}
                step={1e8}
                onChange={(n) => patch("universe", { market_cap_min: n })}
              />
              <Num
                label="Max names for bars"
                value={doc.universe.max_tickers}
                min={50}
                max={8000}
                step={100}
                onChange={(n) => patch("universe", { max_tickers: n })}
              />
            </div>
          </section>

          <section className="card sec" id="scanner">
            <h2>Scanner</h2>
            <p className="notes">{STRATEGY_SECTIONS[2].summary}</p>
            <div className="fields">
              <div className="span-3">
                <Check
                  label="Run the scanner"
                  checked={doc.scanner.enabled}
                  onChange={(v) => patch("scanner", { enabled: v })}
                />
              </div>
              <Num label="Min price" value={doc.scanner.price_min} min={0} step={1} onChange={(n) => patch("scanner", { price_min: n })} />
              <Num
                label="Min avg volume"
                hint="63-session average shares."
                value={doc.scanner.avg_volume_min}
                min={0}
                step={100000}
                onChange={(n) => patch("scanner", { avg_volume_min: n })}
              />
              <Num
                label="Max % below 52w high"
                value={doc.scanner.pct_below_52w_high_max}
                min={0}
                max={80}
                step={1}
                onChange={(n) => patch("scanner", { pct_below_52w_high_max: n })}
              />
              <Num
                label="Max weekly volatility %"
                value={doc.scanner.weekly_volatility_max}
                min={0.1}
                max={30}
                step={0.1}
                onChange={(n) => patch("scanner", { weekly_volatility_max: n })}
              />
              <Num
                label="Earnings blackout, days"
                hint="Skip names reporting inside this many sessions."
                value={doc.scanner.earnings_blackout_days}
                min={0}
                max={30}
                step={1}
                onChange={(n) => patch("scanner", { earnings_blackout_days: n })}
              />
              <Num label="Target min names" value={doc.scanner.target_min} min={1} step={1} onChange={(n) => patch("scanner", { target_min: n })} />
              <Num label="Target max names" value={doc.scanner.target_max} min={1} step={1} onChange={(n) => patch("scanner", { target_max: n })} />
              <div className="span-3 checks">
                <Check label="Price above SMA50" checked={doc.scanner.above_sma50} onChange={(v) => patch("scanner", { above_sma50: v })} />
                <Check label="Price above SMA200" checked={doc.scanner.above_sma200} onChange={(v) => patch("scanner", { above_sma200: v })} />
                <Check label="SMA50 above SMA200" checked={doc.scanner.sma50_above_sma200} onChange={(v) => patch("scanner", { sma50_above_sma200: v })} />
              </div>
              <div className="span-3">
                <div className="kicker">Relaxation ladder</div>
                <p className="notes">If the strict scan is shorter than the target, loosen these one step at a time.</p>
              </div>
              <Num label="Ladder: % below high" value={doc.scanner.ladder_high_pct} step={1} onChange={(n) => patch("scanner", { ladder_high_pct: n })} />
              <Num label="Ladder: weekly vol %" value={doc.scanner.ladder_volatility_max} step={0.1} onChange={(n) => patch("scanner", { ladder_volatility_max: n })} />
              <Num label="Ladder: min volume" value={doc.scanner.ladder_volume_min} step={50000} onChange={(n) => patch("scanner", { ladder_volume_min: n })} />
              <Num label="Ladder: min market cap" value={doc.scanner.ladder_market_cap_min} step={1e8} onChange={(n) => patch("scanner", { ladder_market_cap_min: n })} />
            </div>
          </section>

          <section className="card sec" id="technical">
            <h2>Technical</h2>
            <p className="notes">{STRATEGY_SECTIONS[3].summary}</p>
            <div className="fields">
              <div className="span-3">
                <Check label="Score technicals" checked={doc.technical.enabled} onChange={(v) => patch("technical", { enabled: v })} />
              </div>
              <Num
                label="Min trend score"
                hint="Out of 8. Below this, the name is dropped."
                value={doc.technical.min_trend_score}
                min={1}
                max={8}
                step={1}
                onChange={(n) => patch("technical", { min_trend_score: n })}
              />
              <Num
                label="Near-high %"
                value={doc.technical.near_high_pct}
                min={1}
                max={40}
                step={1}
                onChange={(n) => patch("technical", { near_high_pct: n })}
              />
              <Num
                label="Min RS rating"
                value={doc.technical.rs_rating_min}
                min={1}
                max={99}
                step={1}
                onChange={(n) => patch("technical", { rs_rating_min: n })}
              />
              <div className="span-3">
                <div className="kicker">Patterns</div>
                <div className="checks">
                  {PATTERN_OPTIONS.map(([key, label]) => (
                    <Check key={key} label={label} checked={doc.technical.patterns.includes(key)} onChange={() => togglePattern(key)} />
                  ))}
                </div>
              </div>
              <div className="span-3 checks">
                <Check
                  label="RS rating is a hard filter"
                  checked={doc.technical.rs_hard_filter}
                  onChange={(v) => patch("technical", { rs_hard_filter: v })}
                />
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
                step={0.05}
                onChange={(n) => patch("technical", { vcp_max_ratio: n })}
              />
              <Num
                label="Overhead lookback, months"
                value={doc.technical.overhead_lookback_months}
                min={3}
                max={60}
                step={1}
                onChange={(n) => patch("technical", { overhead_lookback_months: n })}
              />
              <Num
                label="Supply zone, % above price"
                value={doc.technical.overhead_zone_pct}
                min={1}
                max={40}
                step={1}
                onChange={(n) => patch("technical", { overhead_zone_pct: n })}
              />
            </div>
          </section>

          <section className="card sec" id="risk">
            <h2>Risk</h2>
            <p className="notes">{STRATEGY_SECTIONS[4].summary}</p>
            <div className="fields">
              <Num label="Account size, USD" value={doc.risk.account_size_usd} min={100} step={100} onChange={(n) => patch("risk", { account_size_usd: n })} />
              <Num label="Risk % per trade" value={doc.risk.risk_pct} min={0.1} max={5} step={0.1} onChange={(n) => patch("risk", { risk_pct: n })} />
              <Num label="Heat cap %" value={doc.risk.heat_cap_pct} min={0.5} max={20} step={0.5} onChange={(n) => patch("risk", { heat_cap_pct: n })} />
              <Num label="Max positions" value={doc.risk.max_positions} min={1} max={30} step={1} onChange={(n) => patch("risk", { max_positions: n })} />
              <Num label="Max per sector" value={doc.risk.max_per_sector} min={1} max={10} step={1} onChange={(n) => patch("risk", { max_per_sector: n })} />
              <Num label="Max notional %" value={doc.risk.max_notional_pct} min={5} max={100} step={1} onChange={(n) => patch("risk", { max_notional_pct: n })} />
              <Num label="Stop max % (normal)" value={doc.risk.stop_max_pct} min={1} max={30} step={0.5} onChange={(n) => patch("risk", { stop_max_pct: n })} />
              <Num label="Stop max % (loose)" hint="Used only when the structural stop is wider than the normal cap." value={doc.risk.stop_max_pct_loose} min={1} max={40} step={0.5} onChange={(n) => patch("risk", { stop_max_pct_loose: n })} />
              <Num label="Minimum R" value={doc.risk.min_r} min={1} max={10} step={0.5} onChange={(n) => patch("risk", { min_r: n })} />
              <Num label="Entry buffer min %" value={doc.risk.entry_buffer_min_pct} min={0} max={5} step={0.1} onChange={(n) => patch("risk", { entry_buffer_min_pct: n })} />
              <Num label="Entry buffer max %" value={doc.risk.entry_buffer_max_pct} min={0} max={5} step={0.1} onChange={(n) => patch("risk", { entry_buffer_max_pct: n })} />
            </div>
          </section>

          <section className="card sec" id="regime">
            <h2>Regime</h2>
            <p className="notes">{STRATEGY_SECTIONS[5].summary}</p>
            <div className="fields">
              <div className="span-3">
                <Check label="Gate new entries on regime" checked={doc.regime.enabled} onChange={(v) => patch("regime", { enabled: v })} />
              </div>
              <Num label="Distribution days: half size" value={doc.regime.distribution_pressure} min={1} max={20} step={1} onChange={(n) => patch("regime", { distribution_pressure: n })} />
              <Num label="Distribution days: no entries" value={doc.regime.distribution_correction} min={1} max={25} step={1} onChange={(n) => patch("regime", { distribution_correction: n })} />
              <Num label="Breadth risk-on %" value={doc.regime.breadth_risk_on_pct} step={1} onChange={(n) => patch("regime", { breadth_risk_on_pct: n })} />
              <Num label="Breadth risk-off %" value={doc.regime.breadth_risk_off_pct} step={1} onChange={(n) => patch("regime", { breadth_risk_off_pct: n })} />
              <Num label="Futures red threshold %" hint="ES/NQ below this at the open blocks the morning." value={doc.regime.futures_red_pct} step={0.05} onChange={(n) => patch("regime", { futures_red_pct: n })} />
              <div className="span-3">
                <Check
                  label="Respect macro blackout (CPI, NFP, FOMC)"
                  checked={doc.regime.respect_macro_blackout}
                  onChange={(v) => patch("regime", { respect_macro_blackout: v })}
                />
              </div>
            </div>
          </section>

          <section className="card sec" id="news">
            <h2>News</h2>
            <p className="notes">{STRATEGY_SECTIONS[6].summary}</p>
            <div className="fields">
              <div className="span-3">
                <Check label="Read news before a plan is kept" checked={doc.news.enabled} onChange={(v) => patch("news", { enabled: v })} />
              </div>
              <Num label="Lookback, days" value={doc.news.lookback_days} min={1} max={30} step={1} onChange={(n) => patch("news", { lookback_days: n })} />
              <Num label="Headlines per name" value={doc.news.max_headlines} min={1} max={30} step={1} onChange={(n) => patch("news", { max_headlines: n })} />
              <Num
                label="Warn if earnings within, days"
                hint="Open positions, not the scanner blackout."
                value={doc.news.earnings_warn_days}
                min={0}
                max={15}
                step={1}
                onChange={(n) => patch("news", { earnings_warn_days: n })}
              />
              <label className="span-3">
                Red-flag phrases
                <input value={flagsText} onChange={(e) => setFlagsText(e.target.value)} />
                <span className="hint">Comma-separated. A headline containing one of these marks the name.</span>
              </label>
            </div>
          </section>

          <section className="card sec" id="alerts">
            <h2>Alerts</h2>
            <p className="notes">{STRATEGY_SECTIONS[7].summary}</p>
            <div className="fields">
              <div className="span-3">
                <Check label="Raise intraday alerts" checked={doc.alerts.enabled} onChange={(v) => patch("alerts", { enabled: v })} />
              </div>
              <Txt label="Session start" hint="ET, 24-hour." value={doc.alerts.session_start} onChange={(s) => patch("alerts", { session_start: s })} />
              <Txt label="Session end" value={doc.alerts.session_end} onChange={(s) => patch("alerts", { session_end: s })} />
              <Num label="Min RVOL" value={doc.alerts.rvol_min} min={0.5} max={10} step={0.1} onChange={(n) => patch("alerts", { rvol_min: n })} />
              <Num
                label="No-chase, % through entry"
                value={doc.alerts.no_chase_pct}
                min={0}
                max={10}
                step={0.1}
                onChange={(n) => patch("alerts", { no_chase_pct: n })}
              />
              <div className="span-3 checks">
                <Check label="Require price above VWAP" checked={doc.alerts.require_above_vwap} onChange={(v) => patch("alerts", { require_above_vwap: v })} />
                <Check
                  label="Require price above prior close"
                  checked={doc.alerts.require_above_prior_close}
                  onChange={(v) => patch("alerts", { require_above_prior_close: v })}
                />
              </div>
            </div>
          </section>

          <section className="card sec" id="management">
            <h2>Management</h2>
            <p className="notes">{STRATEGY_SECTIONS[8].summary}</p>
            <div className="fields">
              <Num label="Sell half at R" value={doc.management.sell_half_at_r} min={0.5} max={10} step={0.5} onChange={(n) => patch("management", { sell_half_at_r: n })} />
              <Num label="Trail under EMA" value={doc.management.trail_ema} min={3} max={50} step={1} onChange={(n) => patch("management", { trail_ema: n })} />
              <Num
                label="Earnings decision, days"
                value={doc.management.earnings_decision_days}
                min={0}
                max={15}
                step={1}
                onChange={(n) => patch("management", { earnings_decision_days: n })}
              />
              <div className="span-3">
                <Check
                  label="Exit a failed breakout (close back under resistance)"
                  checked={doc.management.exit_failed_breakout}
                  onChange={(v) => patch("management", { exit_failed_breakout: v })}
                />
              </div>
            </div>
          </section>

          {err ? <p className="notes" style={{ color: "var(--red)" }}>{err}</p> : null}
          <div className="savebar card">
            <div>
              {id ? (
                <button className="btn danger" type="button" disabled={busy} onClick={onDelete}>
                  Delete
                </button>
              ) : (
                <span className="notes">Starts from the current swing routine. Change any section, then save.</span>
              )}
            </div>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Saving…" : id ? "Save changes" : "Save strategy"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
