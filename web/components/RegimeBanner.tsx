import Link from "next/link";
import { num, pct, sizingLabel } from "@/lib/format";
import { callForStrategy, type RegimeRules } from "@/lib/regime-call";
import type { RegimeReport, Sizing } from "@/lib/types";

export type RegimeStrategy = {
  id: string;
  name: string;
  rules: RegimeRules;
};

function tone(sizing: Sizing, gated: boolean): string {
  if (!gated) return "";
  if (sizing === "none") return "bad";
  if (sizing === "half") return "warn";
  return "ok";
}

function MarketTape({ regime }: { regime: RegimeReport }) {
  const spy = regime.distribution?.find((d) => d.symbol === "SPY");
  const qqq = regime.distribution?.find((d) => d.symbol === "QQQ");
  return (
    <div className="regime-tape">
      <span className="regime-kicker">Market</span>
      <div className="pills">
        <span className={`pill ${regime.spy_above_50 ? "on" : "off"}`}>SPY {regime.spy_above_50 ? ">" : "<"} MA50</span>
        <span className={`pill ${regime.spy_above_200 ? "on" : "off"}`}>SPY {regime.spy_above_200 ? ">" : "<"} MA200</span>
        <span className={`pill ${regime.qqq_above_50 ? "on" : "off"}`}>QQQ {regime.qqq_above_50 ? ">" : "<"} MA50</span>
        <span className={`pill ${regime.qqq_above_200 ? "on" : "off"}`}>QQQ {regime.qqq_above_200 ? ">" : "<"} MA200</span>
        {regime.es_pct != null ? <span className="pill">ES {pct(regime.es_pct, 2)}</span> : null}
        {regime.nq_pct != null ? <span className="pill">NQ {pct(regime.nq_pct, 2)}</span> : null}
        {spy ? <span className="pill">SPY DD {spy.distribution_days}</span> : null}
        {qqq ? <span className="pill">QQQ DD {qqq.distribution_days}</span> : null}
        {regime.breadth_pct_above_50 != null ? <span className="pill">Breadth 50 {num(regime.breadth_pct_above_50, 0)}%</span> : null}
        {regime.faber_risk_on != null ? (
          <span className={`pill ${regime.faber_risk_on ? "on" : "off"}`}>Faber {regime.faber_risk_on ? "on" : "off"}</span>
        ) : null}
      </div>
    </div>
  );
}

export function RegimeBanner({ regime, strategies }: { regime: RegimeReport; strategies: RegimeStrategy[] }) {
  const calls = strategies.length
    ? strategies.map((s) => ({ id: s.id, name: s.name, href: `/strategies/${s.id}`, rules: s.rules, call: callForStrategy(regime, s.rules) }))
    : [
        {
          id: "desk",
          name: "Desk",
          href: "/strategies",
          rules: null as RegimeRules | null,
          call: {
            sizing: regime.sizing,
            gated: true,
            label: sizingLabel(regime.sizing),
            reason: (regime.notes ?? []).join(" · ") || "No regime note was stored.",
            maxNew: regime.max_new_positions ?? null,
            extra: [],
          },
        },
      ];

  return (
    <section className="regime-board">
      <MarketTape regime={regime} />
      <div className="regime-grid">
        {calls.map((row) => (
          <article key={row.id} className={`regime-card ${row.call.gated ? row.call.sizing : "open"}`}>
            <div className="regime-top">
              <Link href={row.href} className="regime-name">
                {row.name}
              </Link>
              <span className={`chip ${tone(row.call.sizing, row.call.gated)}`}>{row.call.label}</span>
            </div>
            <p>{row.call.reason}</p>
            {row.call.gated && row.call.maxNew != null ? (
              <p className="regime-max">
                Max {row.call.maxNew} new position{row.call.maxNew === 1 ? "" : "s"}.
              </p>
            ) : null}
            {row.call.extra.map((line) => (
              <p key={line} className="regime-max">
                {line}
              </p>
            ))}
            {row.rules ? (
              <p className="regime-rules">
                {row.rules.enabled
                  ? `Half size at ${row.rules.distribution_pressure} distribution days · no entries at ${row.rules.distribution_correction} · breadth off under ${row.rules.breadth_risk_off_pct}% · futures ${row.rules.futures_red_pct}%`
                  : "Regime gate off."}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
