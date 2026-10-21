import { pct } from "@/lib/format";
import type { Strategy } from "@/lib/strategy";
import type { RegimeReport, Sizing } from "@/lib/types";

export type RegimeRules = Strategy["regime"];

export type RegimeCall = {
  sizing: Sizing;
  gated: boolean;
  label: string;
  reason: string;
  maxNew: number | null;
  extra: string[];
};

function worstFutures(regime: RegimeReport): number | null {
  const vals = [regime.es_pct, regime.nq_pct].filter((n): n is number => n != null && !Number.isNaN(n));
  if (!vals.length) return null;
  return Math.min(...vals);
}

function distributionDays(regime: RegimeReport): number {
  const counts = (regime.distribution ?? []).map((d) => d.distribution_days).filter((n) => Number.isFinite(n));
  if (!counts.length) return 0;
  return Math.max(...counts);
}

/** Read one strategy's regime rules against the shared market tape. */
export function callForStrategy(regime: RegimeReport, rules: RegimeRules): RegimeCall {
  if (!rules.enabled) {
    return {
      sizing: "full",
      gated: false,
      label: "Not gated",
      reason: "This strategy does not block new entries on the market regime.",
      maxNew: null,
      extra: [],
    };
  }

  const flags = [regime.spy_above_50, regime.qqq_above_50, regime.spy_above_200, regime.qqq_above_200];
  if (flags.some((v) => v == null)) {
    return {
      sizing: "half",
      gated: true,
      label: "Half size",
      reason: "Index bars are missing, so this strategy stays at half size.",
      maxNew: 2,
      extra: [],
    };
  }

  let sizing: Sizing = "full";
  let maxNew: number | null = null;
  let reason = "Both indices are above their 50-day averages.";
  if (!regime.spy_above_200 || !regime.qqq_above_200) {
    sizing = "none";
    maxNew = 0;
    reason = "One index is below its 200-day average. Stand aside and keep scanning.";
  } else if (regime.spy_above_50 && regime.qqq_above_50) {
    sizing = "full";
    maxNew = null;
    reason = "Both indices are above their 50-day averages.";
  } else if (regime.spy_above_50 || regime.qqq_above_50) {
    sizing = "half";
    maxNew = 2;
    reason = "One index is above its 50-day average and one is below. Half size, at most 2 new positions.";
  } else {
    sizing = "none";
    maxNew = 0;
    reason = "Both indices are below their 50-day averages. Manage open positions only.";
  }

  const days = distributionDays(regime);
  if (days >= rules.distribution_correction && sizing !== "none") {
    sizing = "none";
    maxNew = 0;
    reason = `${days} distribution days, at this strategy's no-entry line of ${rules.distribution_correction}.`;
  } else if (days >= rules.distribution_pressure && sizing === "full") {
    sizing = "half";
    maxNew = 2;
    reason = `${days} distribution days, at this strategy's half-size line of ${rules.distribution_pressure}.`;
  }

  if (regime.breadth_pct_above_200 != null && regime.breadth_pct_above_200 < rules.breadth_risk_off_pct && sizing === "full") {
    sizing = "half";
    maxNew = 2;
    reason = `Breadth is ${regime.breadth_pct_above_200.toFixed(0)}% above the 200-day, under this strategy's ${rules.breadth_risk_off_pct}% line.`;
  }

  if (regime.faber_risk_on === false) {
    sizing = "none";
    maxNew = 0;
    reason = "SPY is below its 10-month average. This strategy takes no new entries.";
  }

  const extra: string[] = [];
  const worst = worstFutures(regime);
  if (worst != null && worst <= rules.futures_red_pct) {
    extra.push(`Futures ${pct(worst, 2)} are through this strategy's ${rules.futures_red_pct}% line. No new entries before 10:30.`);
  }
  if (rules.respect_macro_blackout && (regime.macro_today ?? []).length) {
    extra.push((regime.macro_today ?? []).map((m) => `${m.name} ${m.time_et} ET`).join(" · "));
  }

  const label = sizing === "full" ? "Full size" : sizing === "half" ? "Half size" : "No new entries";
  return { sizing, gated: true, label, reason, maxNew, extra };
}
