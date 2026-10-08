import type { Strategy } from "./strategy";

/** Advisory findings. They describe the document; they never rewrite it. */

export const REVIEW_SECTIONS = [
  "Profile",
  "Universe",
  "Scanner",
  "Technical",
  "Risk",
  "Regime",
  "News",
  "Alerts",
  "Management",
  "Evaluator",
] as const;

export type ReviewSection = (typeof REVIEW_SECTIONS)[number];
export type ReviewSeverity = "conflict" | "gap" | "note";

export type ReviewFinding = {
  severity: ReviewSeverity;
  section: ReviewSection;
  message: string;
};

export type StrategyReview = {
  findings: ReviewFinding[];
  provider: string;
};

function finding(severity: ReviewSeverity, section: ReviewSection, message: string): ReviewFinding {
  return { severity, section, message: message.slice(0, 280) };
}

/** Numeric and structural conflicts. No model, no rewrite. */
export function ruleFindings(s: Strategy): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const { risk, scanner, technical, regime, alerts, management, evaluator } = s;
  const deepBase = technical.patterns.includes("cup_handle") || technical.patterns.includes("generic_base");

  if (risk.heat_cap_pct < risk.risk_pct) {
    out.push(
      finding(
        "conflict",
        "Risk",
        `Heat cap ${risk.heat_cap_pct}% is below the ${risk.risk_pct}% risk of one full trade, so a single position already breaks the book limit.`,
      ),
    );
  } else if (risk.risk_pct * risk.max_positions > risk.heat_cap_pct + 0.05) {
    out.push(
      finding(
        "note",
        "Risk",
        `A full book of ${risk.max_positions} trades at ${risk.risk_pct}% each is ${trim(risk.risk_pct * risk.max_positions)}% heat, above the ${risk.heat_cap_pct}% cap.`,
      ),
    );
  }

  if (risk.max_per_sector > risk.max_positions) {
    out.push(
      finding(
        "conflict",
        "Risk",
        `Max per sector (${risk.max_per_sector}) is higher than max positions (${risk.max_positions}), so the sector cap never binds.`,
      ),
    );
  }

  if (deepBase && risk.stop_max_pct <= 8 && risk.stop_max_pct_loose < 12) {
    out.push(
      finding(
        "conflict",
        "Risk",
        `A deep-base pattern is on, but even the loose stop cap is ${risk.stop_max_pct_loose}%. Those bases are often rejected for stop distance.`,
      ),
    );
  } else if (deepBase && risk.stop_max_pct <= 8) {
    out.push(
      finding(
        "note",
        "Risk",
        `A deep-base pattern is on and the normal stop cap is ${risk.stop_max_pct}%. The loose cap (${risk.stop_max_pct_loose}%) is the only path that can still accept one.`,
      ),
    );
  }

  if (!scanner.enabled) {
    out.push(finding("gap", "Scanner", "The scanner is off, so nothing builds a candidate list for the later gates."));
  }
  if (
    scanner.enabled &&
    scanner.pct_below_52w_high_max <= 5 &&
    scanner.ladder_high_pct >= scanner.pct_below_52w_high_max + 10 &&
    scanner.target_min >= 20
  ) {
    out.push(
      finding(
        "note",
        "Scanner",
        `The strict high filter is ${scanner.pct_below_52w_high_max}% while the ladder opens to ${scanner.ladder_high_pct}% and the target is ${scanner.target_min} names. Most nights will land on the ladder.`,
      ),
    );
  }

  if (!technical.enabled) {
    out.push(finding("gap", "Technical", "Technical scoring is off, so candidates are not turned into plans."));
  }
  if (technical.enabled && technical.patterns.length === 0) {
    out.push(finding("gap", "Technical", "No chart pattern is selected, so a passing trend still cannot become a plan."));
  }

  if (regime.enabled && regime.distribution_pressure >= regime.distribution_correction) {
    out.push(
      finding(
        "conflict",
        "Regime",
        `Half-size starts at ${regime.distribution_pressure} distribution days, which is not before the no-entry line at ${regime.distribution_correction}.`,
      ),
    );
  }
  if (regime.enabled && regime.breadth_risk_off_pct >= regime.breadth_risk_on_pct) {
    out.push(
      finding(
        "conflict",
        "Regime",
        `Breadth risk-off (${regime.breadth_risk_off_pct}%) is not below risk-on (${regime.breadth_risk_on_pct}%), so the two bands overlap.`,
      ),
    );
  }

  if (alerts.enabled && alerts.session_end <= alerts.session_start) {
    out.push(
      finding("conflict", "Alerts", `Session end ${alerts.session_end} is not after the start ${alerts.session_start}.`),
    );
  }

  if (!management.exit_failed_breakout) {
    out.push(
      finding("gap", "Management", "A failed breakout has no exit. A close back under resistance stays in the book."),
    );
  }

  const gates = evaluator.gates;
  if (!gates.plan_card && !gates.actionable_alert && !gates.management) {
    out.push(finding("note", "Evaluator", "No gate is on, so a ticker that passes the rules is never judged."));
  }
  if (gates.plan_card && evaluator.direction.trim().length < 40) {
    out.push(
      finding("gap", "Evaluator", "Direction is too short to judge a name. Say what a good setup looks like for this strategy."),
    );
  }
  if (gates.plan_card && !evaluator.must_pass.trim() && !evaluator.disqualify.trim()) {
    out.push(
      finding("gap", "Evaluator", "Must-pass and disqualify are both empty, so the agent has no qualitative rule to apply."),
    );
  }
  if (gates.plan_card && !evaluator.do_not.trim()) {
    out.push(
      finding(
        "note",
        "Evaluator",
        "Add a limit: the agent must not change the stop or invent a catalyst.",
      ),
    );
  }

  return out;
}

/** Thesis-versus-rules checks used when no model is available. */
export function thesisFindings(s: Strategy): ReviewFinding[] {
  const thesis = s.profile.thesis.toLowerCase();
  const out: ReviewFinding[] = [];
  if (/\b(catalyst|headline|news)\b/.test(thesis) && !s.news.enabled) {
    out.push(finding("gap", "News", "The thesis depends on news or a catalyst, and the news gate is off."));
  }
  if (/\b(market trend|regime|risk-on|risk on)\b/.test(thesis) && !s.regime.enabled) {
    out.push(finding("gap", "Regime", "The thesis depends on the market trend, and the regime gate is off."));
  }
  if (/\btight\b/.test(thesis) && s.risk.stop_max_pct >= 12) {
    out.push(
      finding("note", "Risk", `The thesis says tight, and the normal stop cap is ${s.risk.stop_max_pct}%.`),
    );
  }
  return out;
}

export function dedupeFindings(items: ReviewFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  const out: ReviewFinding[] = [];
  for (const item of items) {
    const key = `${item.section}|${item.message.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 12);
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
