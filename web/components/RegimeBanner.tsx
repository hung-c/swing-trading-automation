import { num, pct, sizingLabel } from "@/lib/format";
import type { RegimeReport } from "@/lib/types";

export function RegimeBanner({ regime }: { regime: RegimeReport }) {
  const spy = regime.distribution?.find((d) => d.symbol === "SPY");
  const qqq = regime.distribution?.find((d) => d.symbol === "QQQ");
  return (
    <section className={`banner ${regime.sizing}`}>
      <div>
        <h2>{sizingLabel(regime.sizing)}</h2>
        <div className="lede" style={{ color: "inherit", opacity: 0.85 }}>
          {regime.max_new_positions != null ? `Max ${regime.max_new_positions} new position${regime.max_new_positions === 1 ? "" : "s"}. ` : null}
          {(regime.notes ?? []).join(" · ")}
        </div>
      </div>
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
    </section>
  );
}
