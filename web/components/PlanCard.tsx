import Link from "next/link";
import { distanceToEntry, num, patternName, usd } from "@/lib/format";
import type { PlanCard as Plan } from "@/lib/types";

export function PlanCard({ plan, price, href }: { plan: Plan; price?: number; href?: string }) {
  const dist = distanceToEntry(plan, price);
  const inner = (
    <>
      <div className="plan-top">
        <div>
          <div className="sym">{plan.symbol}</div>
          <div className="pat">
            {patternName(plan.pattern)} · q {num(plan.pattern_quality, 1)}/10 · trend {plan.trend_score}/8
            {plan.sector ? ` · ${plan.sector}` : ""}
          </div>
        </div>
        <div className="pills">
          <span className="chip">{plan.status}</span>
          {plan.earnings?.trading_days_away != null ? (
            <span className={`chip ${plan.earnings.trading_days_away <= 5 ? "warn" : ""}`}>
              ern {plan.earnings.trading_days_away}d
            </span>
          ) : null}
          {dist ? <span className={`chip ${dist.tone === "chase" ? "bad" : dist.tone === "ok" ? "ok" : "warn"}`}>{dist.label}</span> : null}
        </div>
      </div>
      <div className="levels">
        <div className="lv">
          <div className="k">Resistance</div>
          <div className="v">{usd(plan.resistance)}</div>
        </div>
        <div className="lv entry">
          <div className="k">Entry</div>
          <div className="v">{usd(plan.entry)}</div>
        </div>
        <div className="lv stop">
          <div className="k">Stop {num(plan.stop_pct, 1)}%</div>
          <div className="v">{usd(plan.stop)}</div>
        </div>
        <div className="lv tgt">
          <div className="k">2R · {plan.shares} sh</div>
          <div className="v">{usd(plan.target_2r)}</div>
        </div>
      </div>
      {plan.rejected_reason ? <p className="notes">{plan.rejected_reason}</p> : null}
      {plan.notes?.length ? <p className="notes">{plan.notes.join(" · ")}</p> : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="plan">
        {inner}
      </Link>
    );
  }
  return <article className="plan">{inner}</article>;
}
